"""Pembaca prediksi Allora langsung dari chain Allora lewat LCD (REST API node Cosmos). Gratis, tanpa API key.

Dipakai oleh relayer (`relayer/allora_relayer.py`) dan desk Macro (`firm/allora_client.py`).
Hanya pustaka standar, supaya image relayer tidak butuh paket tambahan.

Sumber (docs.allora.network):
  * consume/rpc-grpc dan consume/api: `combined_value` adalah nilai gabungan jaringan, nilai yang disarankan
    kalau hanya butuh satu angka. Ini juga yang dikirim API Allora sebagai `network_inference_normalized`.
  * reference/networks: mainnet `allora-mainnet-1`, LCD `https://allora-api.mainnet.allora.network/`,
    namespace `emissions/v10`.

LCD tidak memberi waktu inference, hanya `inference_block_height`. Waktunya diambil dari header blok itu.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext

DEFAULT_LCD_URL = "https://allora-api.mainnet.allora.network"
DEFAULT_EMISSIONS_NS = "emissions/v10"
SCALE_DECIMALS = 18
TRIES = 3
TIMEOUT_SEC = 15
_TRANSIENT_HTTP = {429, 500, 502, 503, 504}


class AlloraLcdError(RuntimeError):
    """LCD tidak bisa dibaca, atau isinya tidak bisa dipakai."""


@dataclass(frozen=True)
class LcdInference:
    topic_id: int
    value: Decimal          # combined_value apa adanya, misalnya 73670.5604...
    block_height: int       # inference_block_height
    timestamp: int          # waktu blok itu, detik Unix (UTC)

    @property
    def value_1e18(self) -> int:
        return to_scaled_int(self.value)


def lcd_url() -> str:
    return (os.environ.get("ALLORA_LCD_URL") or DEFAULT_LCD_URL).rstrip("/")


def emissions_ns() -> str:
    return (os.environ.get("ALLORA_EMISSIONS_NS") or DEFAULT_EMISSIONS_NS).strip("/")


def to_scaled_int(value: Decimal | str, decimals: int = SCALE_DECIMALS) -> int:
    """Desimal -> bilangan bulat skala 10^decimals, tanpa float. Dibulatkan ke genap terdekat."""
    try:
        d = Decimal(str(value))
    except InvalidOperation as e:
        raise AlloraLcdError(f"nilai bukan angka: {str(value)[:60]}") from e
    if not d.is_finite():
        raise AlloraLcdError(f"nilai tidak terhingga: {value}")
    with localcontext() as ctx:
        ctx.prec = 100
        return int((d * (Decimal(10) ** decimals)).to_integral_value(rounding=ROUND_HALF_EVEN))


def parse_block_time(s: str) -> int:
    """'2026-11-12T03:47:25.856908869Z' -> detik Unix. Pecahan detik dibuang."""
    try:
        base = s.strip().rstrip("Z").split(".")[0]
        return int(datetime.strptime(base, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    except (ValueError, AttributeError) as e:
        raise AlloraLcdError(f"waktu blok tidak bisa dibaca: {str(s)[:60]}") from e


def parse_network_inferences(payload: dict) -> tuple[Decimal, int]:
    """Ambil (combined_value, inference_block_height) dari respons `latest_network_inferences`."""
    ni = payload.get("network_inferences") or {}
    combined = ni.get("combined_value")
    if isinstance(combined, list):
        entry = next((c for c in combined if c.get("label_name") == "y"), combined[0] if combined else None)
        raw = entry.get("value") if entry else None
    else:  # format lama sebelum label (v0.17.0): satu string
        raw = combined
    if raw in (None, ""):
        raise AlloraLcdError("respons LCD tidak berisi combined_value")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as e:
        raise AlloraLcdError(f"combined_value bukan angka: {str(raw)[:60]}") from e
    height = payload.get("inference_block_height") or ni.get("nonce")
    try:
        height = int(height)
    except (TypeError, ValueError) as e:
        raise AlloraLcdError("respons LCD tidak berisi tinggi blok") from e
    if height <= 0:
        raise AlloraLcdError("tinggi blok tidak valid")
    return value, height


def _get_json(path: str, *, tries: int = TRIES, timeout: float = TIMEOUT_SEC) -> dict:
    url = f"{lcd_url()}/{path.lstrip('/')}"
    last = ""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json", "User-Agent": "heliquant/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code not in _TRANSIENT_HTTP:
                break
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = f"{type(e).__name__}: {str(e)[:120]}"
        except ValueError as e:
            last = f"bukan JSON: {str(e)[:120]}"
            break
        if attempt < tries - 1:
            time.sleep(2 * (attempt + 1))
    raise AlloraLcdError(f"gagal membaca LCD Allora {path}: {last}")


def block_time(height: int) -> int:
    data = _get_json(f"cosmos/base/tendermint/v1beta1/blocks/{int(height)}")
    try:
        return parse_block_time(data["block"]["header"]["time"])
    except (KeyError, TypeError) as e:
        raise AlloraLcdError(f"header blok {height} tidak lengkap") from e


def fetch_latest(topic_id: int) -> LcdInference:
    """Prediksi jaringan terbaru untuk satu topik, lengkap dengan waktu bloknya."""
    value, height = parse_network_inferences(_get_json(f"{emissions_ns()}/latest_network_inferences/{int(topic_id)}"))
    return LcdInference(topic_id=int(topic_id), value=value, block_height=height, timestamp=block_time(height))
