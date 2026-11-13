"""Provider-agnostic LLM client for HeliQuant — bring-your-own-key (BYO).

Two API shapes cover virtually every provider:
  - "openai"    : POST {base}/chat/completions, Authorization: Bearer
                  (OpenAI, OpenRouter, Groq, DeepSeek, Together, xAI, ... and most others)
  - "anthropic" : POST {base}/v1/messages, x-api-key + anthropic-version
                  (Anthropic direct)

Choose a provider with env `HQ_PROVIDER` (default: openrouter). Override the model with
`HQ_MODEL`, the base URL with `HQ_BASE_URL`, and the key with `HQ_API_KEY` (or just set the
provider's own *_API_KEY in .env). In production, an operator plugs in *their* provider —
no lock-in.

Reliability: rotates across a model pool (e.g. OpenRouter free), backs off on 429/5xx, and
skips null-content / non-JSON replies when `expect_json=True`.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import requests

_ENV_CACHE: dict[str, str] = {}


def _load_env() -> dict[str, str]:
    if _ENV_CACHE:
        return _ENV_CACHE
    for base in (Path(__file__).resolve().parents[2], Path(__file__).resolve().parents[1], Path.cwd()):
        p = base / ".env"
        if p.exists():
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    _ENV_CACHE.setdefault(k.strip(), v.strip())
            break
    return _ENV_CACHE


def _env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name) or _load_env().get(name) or default


KEY_ALIASES: dict[str, tuple[str, ...]] = {"NEARAI_API_KEY": ("NEAR_API_KEY_AI_CREDITS",)}


def _collect_keys(key_env: str) -> list[str]:
    """Gather every key for a provider so we can rotate across them (the operator's
    'multiply your keys' trick to spread free-tier rate limits over several accounts):
      - HQ_API_KEY (explicit override; comma-separated allowed) first, then
      - the provider's own key + numbered variants: OPENROUTER_API_KEY, _2, _3, _4, _5
    Returns a de-duplicated, order-preserving list."""
    raw: list[str] = []
    hq = _env("HQ_API_KEY")
    if hq:
        raw.append(hq)
    for suffix in ("", "_2", "_3", "_4", "_5"):
        v = _env(key_env + suffix)
        if v:
            raw.append(v)
    for alias in KEY_ALIASES.get(key_env, ()):   # nama env alternatif (mis. dari dashboard kredit)
        v = _env(alias)
        if v:
            raw.append(v)
    seen, out = set(), []
    for item in raw:
        for k in item.split(","):
            k = k.strip()
            if k and k not in seen:
                seen.add(k)
                out.append(k)
    return out


PROVIDERS = {
    "openrouter": {"base": "https://openrouter.ai/api/v1", "style": "openai", "key_env": "OPENROUTER_API_KEY", "free_pool": True},
    "groq":       {"base": "https://api.groq.com/openai/v1", "style": "openai", "key_env": "GROQ_API_KEY", "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]},
    "openai":     {"base": "https://api.openai.com/v1", "style": "openai", "key_env": "OPENAI_API_KEY", "default_model": "gpt-4o-mini"},
    "deepseek":   {"base": "https://api.deepseek.com", "style": "openai", "key_env": "DEEPSEEK_API_KEY", "default_model": "deepseek-chat"},
    "anthropic":  {"base": "https://api.anthropic.com", "style": "anthropic", "key_env": "ANTHROPIC_API_KEY", "default_model": "claude-haiku-4-5-20251001"},
    # NEAR AI Cloud (TEE): model ID kanonik, jawaban punya tanda tangan TEE (firm/tee.py). Model diisi di _provider().
    "nearai":     {"base": "https://cloud-api.near.ai/v1", "style": "nearai", "key_env": "NEARAI_API_KEY", "models": ["Qwen/Qwen3.8-27B"]},
}

NEARAI_DEFAULT_MODEL = "Qwen/Qwen3.8-27B"


def _provider(name: str | None = None, model: str | None = None) -> dict:
    explicit = name is not None
    name = (name or _env("HQ_PROVIDER") or "openrouter").lower()
    cfg = dict(PROVIDERS.get(name, PROVIDERS["openrouter"]))
    cfg["name"] = name
    if name == "nearai":
        cfg["models"] = [_env("NEARAI_MODEL") or NEARAI_DEFAULT_MODEL]
    if not explicit and _env("HQ_BASE_URL"):
        cfg["base"] = _env("HQ_BASE_URL")
    cfg["keys"] = _collect_keys(cfg["key_env"])
    cfg["key"] = cfg["keys"][0] if cfg["keys"] else ""
    cfg["model_override"] = model if model else (None if explicit else _env("HQ_MODEL"))
    return cfg


def _is_free(m: dict) -> bool:
    try:
        p = m.get("pricing", {})
        return float(p.get("prompt", "1")) == 0 and float(p.get("completion", "1")) == 0
    except Exception:
        return False


def _free_pool(base: str, key: str) -> list[str]:
    try:
        r = requests.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"}, timeout=30)
        free = [m["id"] for m in r.json().get("data", []) if _is_free(m)]
        order = ["kimi", "deepseek", "qwen", "llama", "glm", "mistral", "gemini", "gpt", "nemotron"]
        ranked = sorted(free, key=lambda i: next((k for k, p in enumerate(order) if p in i.lower()), 99))
        return ranked[:6]
    except Exception:
        return []


def _models(cfg: dict) -> list[str]:
    if cfg.get("model_override"):
        # preferred model FIRST, then the rest of the provider's pool as a 429 fallback — never hard-lock a
        # role to ONE model, or the whole call fails when that model is saturated across every key (the
        # "429 on llama-3.1-8b-instant key 10/10" failure). Try the preference, then fall through.
        ov = cfg["model_override"]
        if cfg.get("name") == "nearai":
            return [ov]   # model khusus NEAR AI tidak jatuh ke model utama (bisa berpikir lama); cadangan = provider lain
        return [ov] + [m for m in (cfg.get("models") or []) if m != ov]
    if cfg.get("free_pool"):
        pool = _free_pool(cfg["base"], cfg["key"])
        if pool:
            return pool
        return ["moonshotai/kimi-k2.6:free", "meta-llama/llama-3.3-70b-instruct:free"]  # free offline fallback
    if cfg.get("models"):
        return list(cfg["models"])
    return [cfg.get("default_model", "gpt-4o-mini")]


def _has_json(s: str) -> bool:
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        return False
    try:
        json.loads(m.group(0))
        return True
    except Exception:
        return False


def _nearai_timeout() -> float:
    """Batas tunggu jawaban NEAR AI (non-streaming: server baru membalas setelah semua token selesai). Bawaan 240 dtk."""
    try:
        return float(_env("NEARAI_TIMEOUT_S") or 240)
    except ValueError:
        return 240.0


def _request(cfg: dict, key: str, model: str, system: str, user: str, max_tokens: int,
             no_think: bool = False, thinking_budget: int | None = None,
             timeout: float | None = None) -> requests.Response:
    if cfg["style"] == "nearai":
        # Body dibangun SEKALI sebagai byte dan response dipertahankan mentah: tanda tangan TEE mengikat
        # sha256(byte request) dan sha256(byte response). Jangan streaming dan jangan parse-lalu-serialize ulang.
        payload = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                   "max_tokens": max_tokens, "temperature": 0.2, "stream": False}
        if no_think:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if thinking_budget:   # GLM-5.3-flash: batas token reasoning, field level atas (docs.near.ai reasoning-models)
            payload["thinking_token_budget"] = int(thinking_budget)
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        r = requests.post(f"{cfg['base']}/chat/completions", data=body, timeout=timeout or _nearai_timeout(), headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json",
            "Accept-Encoding": "identity", "x-no-aliasing": "true"})
        r._tee_body = body  # dipakai _complete_one untuk bukti TEE
        return r
    if cfg["style"] == "anthropic":
        return requests.post(
            f"{cfg['base']}/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
            json={"model": model, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": user}], "temperature": 0.2},
            timeout=120,
        )
    return requests.post(
        f"{cfg['base']}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
              "max_tokens": max_tokens, "temperature": 0.2},
        timeout=120,
    )


def _extract(cfg: dict, j: dict) -> str | None:
    if cfg["style"] == "anthropic":
        return "".join(p.get("text", "") for p in j.get("content", []) if isinstance(p, dict)) or None
    msg = j["choices"][0].get("message", {})
    return msg.get("content") or msg.get("reasoning") or msg.get("reasoning_content")


def _complete_one(system, user, max_tokens, start, expect_json, provider, model, label=None, no_think=False,
                  thinking_budget=None, timeout=None):
    cfg = _provider(provider, model)
    keys = cfg["keys"]
    if not keys:
        raise RuntimeError(f"no API key for provider '{cfg['name']}' — set {cfg['key_env']} (or HQ_API_KEY) in .env")
    tee_on = cfg["style"] == "nearai"
    if tee_on:
        from firm import tee
        if not tee.available():
            raise RuntimeError("nearai unavailable: budget reached or recently rejected")
    models = _models(cfg)
    # keep an explicit model preference FIRST; only rotate the start when picking freely from the pool
    pool = models if cfg.get("model_override") else models[start % len(models):] + models[:start % len(models)]
    last = "no attempts made"
    for model_ in pool:
        for ki, key in enumerate(keys):
            try:
                t0 = time.time()
                r = _request(cfg, key, model_, system, user, max_tokens, no_think, thinking_budget, timeout) if tee_on \
                    else _request(cfg, key, model_, system, user, max_tokens)
                if tee_on and r.status_code in (401, 402, 403):
                    tee.mark_exhausted()  # saldo/batas habis atau kunci ditolak: jangan coba lagi selama 1 jam
                    last = f"HTTP {r.status_code} from nearai"
                    break
                if r.status_code in (429, 500, 502, 503):
                    last = f"HTTP {r.status_code} on {model_} (key {ki + 1}/{len(keys)})"
                    continue  # a different key has its own quota; else fall through to next model
                r.raise_for_status()
                j = r.json()
                if tee_on:
                    tee.add_cost(j.get("usage"), model_)   # semua jawaban 200 ditagih, termasuk yang kosong
                content = _extract(cfg, j)
                if not (isinstance(content, str) and content.strip()):
                    last = f"empty content from {model_}"
                    continue
                if expect_json and not _has_json(content):
                    last = f"no parseable JSON from {model_}"
                    break  # this model won't emit JSON; move to the next model
                if tee_on:
                    tee.record_call(label or "llm", model_, r._tee_body, r.content, j, key, seconds=time.time() - t0)
                return content, f"{cfg['name']}:{model_}"
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__} on {model_}: {str(e)[:50]}"
        time.sleep(1.5)  # gentle spacing between models (free-tier friendly)
    raise RuntimeError(f"all attempts failed ({last})")


def complete(system: str, user: str, max_tokens: int = 700, start: int = 0, expect_json: bool = False,
             provider: str | None = None, model: str | None = None, fallback: str | None = None,
             label: str | None = None, no_think: bool = False, thinking_budget: int | None = None,
             timeout: float | None = None) -> tuple[str, str]:
    """Return (content, 'provider:model'). Optionally route to a specific `provider`/`model`
    (e.g. heavy reasoning on a stronger model) with graceful `fallback` to another provider if
    the primary fails. Rotates across keys then models; skips 429/5xx / null / non-JSON.

    `fallback` kosong -> env `HQ_FALLBACK_PROVIDER` (bawaan groq), dipakai hanya kalau beda dari provider utama.
    `fallback="none"` mematikan cadangan (pemanggil menangani sendiri).
    `label` memberi nama panggilan di bukti TEE; `no_think` mematikan reasoning (hanya provider nearai).
    `timeout` (detik) menimpa batas tunggu NEAR AI untuk panggilan ini.
    `thinking_budget` membatasi token reasoning (`thinking_token_budget`; hanya nearai dan model yang mendukung, mis. GLM)."""
    primary = (provider or _env("HQ_PROVIDER") or "openrouter").lower()
    fb = (fallback or _env("HQ_FALLBACK_PROVIDER") or "groq").lower()
    try:
        return _complete_one(system, user, max_tokens, start, expect_json, provider, model, label, no_think, thinking_budget,
                             timeout)
    except Exception as e:  # noqa: BLE001
        if fb not in ("none", primary):
            if primary == "nearai" or provider == "nearai":
                from firm import tee
                err = f"{type(e).__name__}: {str(e)[:140]}"
                print(f"   [llm] {label or 'llm'}: NEAR AI gagal ({err}) -> cadangan {fb}")
                tee.record_fallback(label or "llm", fb, error=err)
            return _complete_one(system, user, max_tokens, start, expect_json, fb, None, label, no_think)
        raise


def active_provider_info() -> dict:
    cfg = _provider()
    return {
        "provider": cfg["name"],
        "base": cfg["base"],
        "style": cfg["style"],
        "has_key": bool(cfg["keys"]),
        "num_keys": len(cfg["keys"]),
        "models": _models(cfg) if cfg["keys"] else [],
    }
