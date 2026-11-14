'use client';

import { useTheme } from 'fumadocs-ui/provider/base';
import { useEffect, useId, useState } from 'react';

/**
 * Night-Garage themed Mermaid renderer (client-only — Mermaid needs the DOM).
 * Use in MDX:  <Mermaid caption="One cycle" chart={`sequenceDiagram ...`} />
 * Pass `wide` for a dense/wide chart: it renders at NATURAL size and the wrapper scrolls,
 * so the text stays legible instead of being shrunk to fit. Default charts stay responsive.
 *
 * Theme-aware: it follows the site's light/dark toggle and re-renders when it changes. Charts are
 * written with the dark palette in their `classDef` lines; in light mode those colors are swapped
 * for their light twins (LIGHT_SWAP) before rendering. Palettes mirror app/global.css.
 */
const DARK = {
  page: '#0b0b0b',
  node: '#161614',
  inset: '#1e1e1b',
  ink: '#f2efe6',
  muted: '#8b8b80',
  accent: '#c9f24b',
  border: 'rgba(242,239,230,0.14)',
  note: 'rgba(201,242,75,0.10)',
  cluster: 'rgba(201,242,75,0.05)',
  q1: 'rgba(201,242,75,0.08)',
  q2: 'rgba(201,242,75,0.04)',
  q3: 'rgba(30,30,27,0.6)',
  q4: 'rgba(30,30,27,0.3)',
} as const;

const LIGHT = {
  page: '#f2efe6',
  node: '#f7f5ef',
  inset: '#e9e5d8',
  ink: '#0b0b0b',
  muted: '#5c5c53',
  accent: '#4f6b00',
  border: 'rgba(11,11,11,0.15)',
  note: 'rgba(79,107,0,0.10)',
  cluster: 'rgba(79,107,0,0.05)',
  q1: 'rgba(79,107,0,0.12)',
  q2: 'rgba(79,107,0,0.06)',
  q3: 'rgba(11,11,11,0.06)',
  q4: 'rgba(11,11,11,0.03)',
} as const;

/** dark classDef colors -> light twins, per property (a chartreuse FILL stays: it carries pitch text) */
const LIGHT_SWAP: Record<string, Record<string, string>> = {
  fill: { '#161614': LIGHT.node, '#1e1e1b': LIGHT.inset },
  stroke: { '#c9f24b': LIGHT.accent, '#8b8b80': '#8a8a7c', '#ff5a1f': '#c2410c' },
  color: { '#f2efe6': LIGHT.ink, '#c9f24b': '#3f5600', '#8b8b80': LIGHT.muted, '#ff5a1f': '#c2410c' },
};

function forLight(chart: string): string {
  return chart.replace(/^(\s*(?:classDef|style)\s.*)$/gm, (line) =>
    line.replace(/\b(fill|stroke|color):(#[0-9a-fA-F]{6})/g, (m, prop: string, hex: string) => {
      const to = LIGHT_SWAP[prop]?.[hex.toLowerCase()];
      return to ? `${prop}:${to}` : m;
    }),
  );
}

function themeVariables(dark: boolean) {
  const P = dark ? DARK : LIGHT;
  return {
    darkMode: dark,
    background: P.page,
    primaryColor: P.node,
    primaryTextColor: P.ink,
    primaryBorderColor: P.accent,
    secondaryColor: P.inset,
    secondaryTextColor: P.ink,
    secondaryBorderColor: P.muted,
    tertiaryColor: P.inset,
    tertiaryTextColor: P.ink,
    tertiaryBorderColor: P.muted,
    lineColor: P.muted,
    textColor: P.ink,
    mainBkg: P.node,
    nodeBorder: P.accent,
    clusterBkg: P.cluster,
    clusterBorder: P.border,
    titleColor: P.accent,
    edgeLabelBackground: P.page,
    // sequence
    actorBkg: P.node,
    actorBorder: P.accent,
    actorTextColor: P.ink,
    signalColor: P.ink,
    signalTextColor: P.ink,
    labelBoxBkgColor: P.inset,
    labelBoxBorderColor: P.accent,
    labelTextColor: P.ink,
    loopTextColor: P.muted,
    noteBkgColor: P.note,
    noteBorderColor: P.accent,
    noteTextColor: P.ink,
    activationBkgColor: P.inset,
    // state / class
    stateBkg: P.node,
    // pie
    pie1: P.accent,
    pie2: P.muted,
    pie3: '#5a6b2e',
    pie4: P.inset,
    pieTitleTextColor: P.ink,
    pieSectionTextColor: dark ? DARK.page : LIGHT.page,
    pieStrokeColor: P.page,
    pieOuterStrokeColor: P.muted,
    // quadrant
    quadrant1Fill: P.q1,
    quadrant2Fill: P.q2,
    quadrant3Fill: P.q3,
    quadrant4Fill: P.q4,
    quadrantPointFill: P.accent,
    quadrantPointTextColor: P.ink,
    quadrantTitleFill: P.ink,
    quadrantXAxisTextFill: P.muted,
    quadrantYAxisTextFill: P.muted,
    quadrantInternalBorderStrokeFill: P.border,
    quadrantExternalBorderStrokeFill: P.muted,
  };
}

let _seq = 0;

export function Mermaid({ chart, caption, wide = false }: { chart: string; caption?: string; wide?: boolean }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== 'light';
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          // only `wide` charts opt out of shrink-to-fit (then the wrapper scrolls)
          flowchart: { useMaxWidth: !wide, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: !wide },
          state: { useMaxWidth: !wide },
          class: { useMaxWidth: !wide },
          journey: { useMaxWidth: !wide },
          quadrantChart: { useMaxWidth: !wide },
          mindmap: { useMaxWidth: !wide },
          themeVariables: themeVariables(dark),
        });
        const id = `hqmmd-${reactId}-${_seq++}`;
        const src = dark ? chart.trim() : forLight(chart.trim());
        const { svg } = await mermaid.render(id, src);
        if (alive) setSvg(svg);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [chart, reactId, wide, dark]);

  if (err) {
    return (
      <pre className="my-6 overflow-x-auto rounded-none border border-fd-border bg-fd-card p-4 text-xs text-fd-muted-foreground">
        diagram error: {err}
      </pre>
    );
  }

  const base = 'hq-mermaid overflow-x-auto rounded-none border border-fd-border bg-[var(--hq-plate)] p-4';
  const cls = wide
    ? `${base} [&_svg]:!max-w-none [&_svg]:min-w-fit`
    : `${base} flex justify-center [&_svg]:h-auto [&_svg]:max-w-full`;

  return (
    <figure className="my-7">
      <div
        className={cls}
        // svg is produced by Mermaid from trusted, author-written chart strings
        dangerouslySetInnerHTML={{ __html: svg || '' }}
      />
      {caption ? (
        <figcaption className="mt-2 text-center font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
