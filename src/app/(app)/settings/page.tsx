"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/ui/status";
import { ButtonLink } from "@/components/ui/button";
import { useZeusStore } from "@/store/zeus-store";
import { formatRelativeTime } from "@/lib/format";

/**
 * Settings & Fleet Registry Page.
 *
 * Information Hierarchy:
 *   1. Account Identity (authenticated operator facts)
 *   2. Claimed Fleet Nodes (dense technical registry of nodes, versions, regions, viewer availability)
 *   3. Direct operational empty state with Pair route action
 */
export default function SettingsPage() {
  const { devices, user } = useZeusStore();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & Fleet Registry"
        subtitle="Operator session identity and verified node runtime specifications"
        actions={
          <ButtonLink href="/pair" variant="secondary" size="sm">
            Pair New Node
          </ButtonLink>
        }
      />

      {/* 1. Operator Account Identity */}
      <section aria-labelledby="account-identity-heading" className="space-y-2">
        <h2
          id="account-identity-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted"
        >
          Operator Identity
        </h2>

        <Card className="overflow-hidden bg-surface border-border">
          <div className="divide-y divide-border">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-3 text-xs">
              <span className="text-muted">Signed In As</span>
              <span className="sm:col-span-2 font-medium text-foreground">
                {user?.displayName || user?.username || "—"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-3 text-xs">
              <span className="text-muted">Account Username</span>
              <span className="sm:col-span-2 font-mono text-foreground">
                {user?.username || "—"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-3 text-xs">
              <span className="text-muted">Email Address</span>
              <span className="sm:col-span-2 text-foreground font-mono">
                {user?.email || "—"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-3 text-xs">
              <span className="text-muted">Session Environment</span>
              <span className="sm:col-span-2 text-muted">
                Authenticated Web Control Plane Session · Managed via Supabase Auth
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* 2. Claimed Device Registry */}
      <section aria-labelledby="fleet-registry-heading" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2
            id="fleet-registry-heading"
            className="text-xs font-semibold uppercase tracking-wider text-muted"
          >
            Claimed Fleet Nodes ({devices.length})
          </h2>
          {devices.length > 0 ? (
            <Link
              href="/pair"
              className="text-xs text-muted hover:text-accent transition-colors"
            >
              + Link another node
            </Link>
          ) : null}
        </div>

        {devices.length === 0 ? (
          <Card className="bg-surface border-border">
            <EmptyState
              title="No nodes currently claimed"
              hint="VPS instances running Zeus Agent will appear here once linked using their 8-character claim code."
              action={
                <div className="mt-2">
                  <ButtonLink href="/pair" variant="primary" size="sm">
                    Pair a Device Node
                  </ButtonLink>
                </div>
              }
            />
          </Card>
        ) : (
          <>
            {/* Desktop / Tablet Registry Table (>= 768px) */}
            <div className="hidden md:block overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-elevated/70 text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Node / Device ID</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Region</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Agent Version</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Runtime / Jar</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Viewer Tunnel</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Last Heartbeat</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {devices.map((device) => (
                    <tr
                      key={device.id}
                      className="hover:bg-elevated/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-foreground">
                          {device.name}
                        </div>
                        <div className="font-mono text-[11px] text-muted truncate max-w-[140px]">
                          {device.deviceId}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <DeviceStatusBadge status={device.status} />
                      </td>

                      <td className="px-4 py-3 text-muted font-mono">
                        {device.region || "—"}
                      </td>

                      <td className="px-4 py-3 font-mono text-muted tabular">
                        {device.agentVersion || "—"}
                      </td>

                      <td className="px-4 py-3 font-mono text-muted tabular">
                        {device.runtimeVersion || "—"}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] ${
                            device.viewerAvailable
                              ? "text-online"
                              : "text-muted"
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              device.viewerAvailable ? "bg-online" : "bg-muted/60"
                            }`}
                            aria-hidden="true"
                          />
                          {device.viewerAvailable ? "Available" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-muted tabular">
                        {formatRelativeTime(device.lastSeen)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <ButtonLink
                          href={`/device/${device.deviceId}`}
                          size="sm"
                          variant="secondary"
                        >
                          View Node
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Registry Card List (< 768px) */}
            <div className="space-y-3 md:hidden">
              {devices.map((device) => (
                <Card key={device.id} className="p-4 bg-surface border-border space-y-3">
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
                    <div>
                      <div className="font-mono text-sm font-semibold text-foreground">
                        {device.name}
                      </div>
                      <div className="font-mono text-[11px] text-muted truncate max-w-[180px]">
                        {device.deviceId}
                      </div>
                    </div>
                    <DeviceStatusBadge status={device.status} />
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-muted text-[11px]">Region</dt>
                      <dd className="font-mono text-foreground">{device.region || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted text-[11px]">Last Seen</dt>
                      <dd className="text-foreground tabular">{formatRelativeTime(device.lastSeen)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted text-[11px]">Agent Version</dt>
                      <dd className="font-mono text-muted tabular">{device.agentVersion || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted text-[11px]">Runtime / Jar</dt>
                      <dd className="font-mono text-muted tabular">{device.runtimeVersion || "—"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted text-[11px]">Viewer Tunnel</dt>
                      <dd className={`text-[11px] font-medium ${device.viewerAvailable ? "text-online" : "text-muted"}`}>
                        {device.viewerAvailable ? "Available via secure tunnel" : "Tunnel inactive"}
                      </dd>
                    </div>
                  </dl>

                  <div className="pt-1">
                    <ButtonLink
                      href={`/device/${device.deviceId}`}
                      size="sm"
                      variant="secondary"
                      className="w-full min-h-[44px]"
                    >
                      View Node Operations →
                    </ButtonLink>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
