import { getStackConfig, type StackServiceKey } from "./config.server";
import { log } from "./logger";

type StackEventPayload = {
  eventType: string;
  projectId: string;
  title: string;
  description?: string | null;
  linkedTaskId?: string | null;
  linkedPrId?: string | null;
  linkedDeploymentId?: string | null;
  metadata?: Record<string, unknown>;
};

export function stackServiceSummary() {
  return getStackConfig().map(({ token: _token, endpoint: _endpoint, ...service }) => service);
}

export function emitStackEvent(serviceKey: StackServiceKey, payload: StackEventPayload) {
  const service = getStackConfig().find((entry) => entry.key === serviceKey);
  if (!service || service.mode !== "webhook" || !service.ready || !service.endpoint) {
    return;
  }

  void postStackEvent(serviceKey, service.endpoint, service.token, payload);
}

async function postStackEvent(
  serviceKey: StackServiceKey,
  endpoint: string,
  token: string | null,
  payload: StackEventPayload,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        source: "forgecloud",
        service: serviceKey,
        sentAt: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn("stack_event_dispatch_failed", {
        service: serviceKey,
        status: response.status,
        eventType: payload.eventType,
        projectId: payload.projectId,
      });
    }
  } catch (error) {
    log.warn("stack_event_dispatch_error", {
      service: serviceKey,
      eventType: payload.eventType,
      projectId: payload.projectId,
      error: (error as Error).message,
    });
  } finally {
    clearTimeout(timeout);
  }
}
