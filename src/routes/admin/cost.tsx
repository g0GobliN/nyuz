import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatNumber,
} from "@/components/admin/shell";
import { Chip } from "@/components/kit";
import { getCostIntelligence } from "@/lib/server/cost-intelligence";

export const Route = createFileRoute("/admin/cost")({ component: CostPage });

const WINDOWS = [7, 30, 90] as const;

/**
 * What the pipeline costs, counted (docs/plan2.md phase 10).
 *
 * Every number on this page is a row count or a sum of recorded spend. There
 * is no "estimated saving" and no projected monthly bill: the honest version
 * of either needs to know what work that never happened *would* have cost,
 * and this project does not display figures nobody computed.
 *
 * The flags panel is at the top rather than the bottom because without it
 * every number below is ambiguous — a low skip count could mean the gate is
 * working well or simply switched off.
 */
function CostPage() {
  const [days, setDays] = useState<number>(30);

  const cost = useQuery({
    queryKey: ["admin", "cost", days],
    queryFn: () => getCostIntelligence({ data: { days } }),
    staleTime: 60_000,
  });

  const data = cost.data;

  return (
    <>
      <ConsoleHeader
        title="Cost"
        sub="What the pipeline is spending, and what the demand-driven work measurably changed. Everything here is counted from rows — there are no projections on this page, and no figure appears that nobody computed."
      />

      <ErrorNote error={cost.error} />

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {WINDOWS.map((w) => (
          <Chip key={w} active={days === w} onClick={() => setDays(w)}>
            {w} days
          </Chip>
        ))}
      </div>

      {cost.isLoading ? <Loading label="Counting" /> : null}

      {!cost.isLoading && data === null ? (
        <Panel>
          <p className="text-[13.5px] leading-relaxed text-signal">
            <code className="font-mono">admin_cost_intelligence()</code> is not in this database.
            Apply migration 0035 to see these numbers. Nothing is estimated in its absence.
          </p>
        </Panel>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <Panel title="What is switched on">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.flags).map(([key, enabled]) => (
                <Pill key={key} tone={enabled ? "signal" : "outline"}>
                  {key} · {enabled ? "on" : "off"}
                </Pill>
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Read this first. A low skip count means one thing when the gate is on and something
              entirely different when it is off.
            </p>
          </Panel>

          <Panel title="Sources">
            <StatGrid>
              <Stat label="Active" value={formatNumber(data.sources.active)} />
              <Stat
                label="Core"
                value={formatNumber(data.sources.core)}
                hint="Collected regardless of demand"
              />
              <Stat
                label="Demand"
                value={formatNumber(data.sources.demand)}
                hint="Collected because somebody wants them"
              />
              <Stat
                label="No demand"
                value={formatNumber(data.sources.no_demand)}
                hint="Past the grace period"
              />
            </StatGrid>
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill tone="outline">hot {data.sources.hot}</Pill>
              <Pill tone="outline">normal {data.sources.normal}</Pill>
              <Pill tone="outline">low {data.sources.low}</Pill>
              <Pill tone="outline">cold {data.sources.cold}</Pill>
              <Pill tone="outline">paused {data.sources.paused_tier}</Pill>
            </div>
          </Panel>

          <Panel title="Events and analysis">
            <StatGrid>
              <Stat label="Analysed" value={formatNumber(data.events.analysed)} />
              <Stat
                label="Awaiting"
                value={formatNumber(data.events.awaiting)}
                hint="Pending, not lost"
              />
              <Stat label="Analysis tokens" value={formatNumber(data.events.analysis_tokens)} />
              <Stat
                label="Tokens per event"
                value={
                  data.events.tokens_per_event === null
                    ? "—"
                    : formatNumber(data.events.tokens_per_event)
                }
                hint="Measured mean, charged once each"
              />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              {formatNumber(data.articles.unclustered)} articles are still unclustered, of{" "}
              {formatNumber(data.articles.total)} stored.
            </p>
          </Panel>

          <Panel title="Shared impacts">
            <StatGrid>
              <Stat label="Written" value={formatNumber(data.impacts.complete)} />
              <Stat label="Failed" value={formatNumber(data.impacts.failed)} />
              <Stat label="Tokens" value={formatNumber(data.impacts.tokens)} />
              <Stat
                label="Briefing appearances"
                value={formatNumber(data.digest_items_total)}
                hint="Served by the impacts above"
              />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Before phase 2 each of those appearances was its own model call. Now they are served
              by {formatNumber(data.impacts.complete)} shared explanations
              {data.impacts.complete > 0 && data.digest_items_total > 0
                ? ` — ${(data.digest_items_total / data.impacts.complete).toFixed(1)} appearances per explanation`
                : ""}
              .
            </p>
          </Panel>

          <Panel title="Translation">
            <StatGrid>
              <Stat label="Cached" value={formatNumber(data.translations.complete)} />
              <Stat label="Languages" value={formatNumber(data.translations.languages)} />
              <Stat label="Failed" value={formatNumber(data.translations.failed)} />
              <Stat label="Tokens" value={formatNumber(data.translations.tokens)} />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              One row per event per language, however many readers see it.
            </p>
          </Panel>

          <Panel title="Cluster v2 agreement">
            {data.cluster_shadow.decided === 0 ? (
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                Not measured yet. Nothing has been clustered with shadow mode on in this window, so
                there is no agreement rate to report — and no basis for enabling the skip.
              </p>
            ) : (
              <>
                <StatGrid>
                  <Stat
                    label="Same — agreed"
                    value={`${data.cluster_shadow.same_agreed}/${data.cluster_shadow.same_decided}`}
                    hint="Wrong here merges unrelated stories"
                  />
                  <Stat
                    label="Different — agreed"
                    value={`${data.cluster_shadow.diff_agreed}/${data.cluster_shadow.diff_decided}`}
                    hint="Wrong here splits one story"
                  />
                  <Stat label="Decided" value={formatNumber(data.cluster_shadow.decided)} />
                  <Stat label="Agreed" value={formatNumber(data.cluster_shadow.agreed)} />
                </StatGrid>
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  Split deliberately: a wrong &ldquo;different&rdquo; costs one extra analysis and
                  shows up as a duplicate. A wrong &ldquo;same&rdquo; merges two unrelated stories
                  and is invisible to the reader who receives it. The two need different standards
                  of proof before the skip goes on.
                </p>
              </>
            )}
          </Panel>

          <Panel title={`AI ledger · last ${data.window_days} days`}>
            {Object.keys(data.ai_usage).length === 0 ? (
              <p className="text-[13.5px] text-muted-foreground">
                No recorded usage in this window.
              </p>
            ) : (
              <StatGrid>
                {Object.entries(data.ai_usage).map(([capability, tokens]) => (
                  <Stat key={capability} label={capability} value={formatNumber(tokens)} />
                ))}
              </StatGrid>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
