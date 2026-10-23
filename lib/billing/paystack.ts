import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { callJson, providerFail, type FetchLike, type ProviderResult } from "./http";
import type { PaystackConfig } from "./plans";

// Paystack REST adapter (https://paystack.com/docs/api/). Every call is
// authenticated with the secret key, which never leaves the server. Responses
// are Zod-parsed down to the fields we use; nothing here throws.

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

const envelope = <T extends z.ZodType>(data: T) => z.object({ status: z.literal(true), data });

const codeObject = (key: string) => z.object({ [key]: z.string() }).loose();

const subscriptionSchema = z
  .object({
    subscription_code: z.string().min(1),
    status: z.string(),
    email_token: z.string().nullish(),
    next_payment_date: z.string().nullish(),
    plan: codeObject("plan_code"),
    customer: codeObject("customer_code"),
    createdAt: z.string().nullish(),
    authorization: z
      .object({
        last4: z.string().nullish(),
        brand: z.string().nullish(),
        card_type: z.string().nullish(),
        exp_month: z.union([z.string(), z.number()]).nullish(),
        exp_year: z.union([z.string(), z.number()]).nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

/** Display-only card details: brand, last 4 and expiry. Never anything more. */
export interface CardSummary {
  brand: string;
  last4: string;
  /** "09/28" */
  exp: string | null;
}

function cardOf(raw: z.infer<typeof subscriptionSchema>["authorization"]): CardSummary | null {
  const last4 = raw?.last4?.trim();
  if (!raw || !last4 || !/^[0-9]{4}$/.test(last4)) return null;
  const brandRaw = (raw.brand || raw.card_type || "card").trim();
  const brand = brandRaw.charAt(0).toUpperCase() + brandRaw.slice(1).toLowerCase();
  const month = String(raw.exp_month ?? "").padStart(2, "0");
  const year = String(raw.exp_year ?? "").slice(-2);
  const exp = /^(0[1-9]|1[0-2])$/.test(month) && /^[0-9]{2}$/.test(year) ? `${month}/${year}` : null;
  return { brand: brand.slice(0, 30), last4, exp };
}

export interface PaystackSubscription {
  code: string;
  /** `active | non-renewing | attention | completed | cancelled` */
  status: string;
  emailToken: string | null;
  planCode: string;
  customerCode: string;
  nextPaymentDate: string | null;
  createdAt: string | null;
  card: CardSummary | null;
}

function toSubscription(raw: z.infer<typeof subscriptionSchema>): PaystackSubscription {
  return {
    code: raw.subscription_code,
    status: raw.status,
    emailToken: raw.email_token ?? null,
    planCode: String(raw.plan.plan_code),
    customerCode: String(raw.customer.customer_code),
    nextPaymentDate: raw.next_payment_date ?? null,
    createdAt: raw.createdAt ?? null,
    card: cardOf(raw.authorization),
  };
}

const transactionSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    reference: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    customer: z.object({ id: z.union([z.number(), z.string()]), customer_code: z.string() }).loose(),
    // A plan code string, a plan object, or empty, depending on the endpoint.
    plan: z.union([z.string(), codeObject("plan_code"), z.null()]).optional(),
    plan_object: z.object({ plan_code: z.string().optional() }).loose().nullish(),
  })
  .loose();

export interface PaystackTransaction {
  id: string;
  /** `success | failed | abandoned | reversed | ongoing | pending | …` */
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  customerId: string;
  customerCode: string;
  planCode: string | null;
}

function planCodeOf(raw: z.infer<typeof transactionSchema>): string | null {
  if (typeof raw.plan === "string" && raw.plan) return raw.plan;
  if (raw.plan && typeof raw.plan === "object") return String(raw.plan.plan_code);
  return raw.plan_object?.plan_code || null;
}

export interface PaystackClient {
  initializeTransaction(input: {
    email: string;
    amountMinor: number;
    planCode: string;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<ProviderResult<{ authorizationUrl: string }>>;
  verifyTransaction(reference: string): Promise<ProviderResult<PaystackTransaction>>;
  fetchSubscription(code: string): Promise<ProviderResult<PaystackSubscription>>;
  listSubscriptions(customerId: string): Promise<ProviderResult<PaystackSubscription[]>>;
  fetchPlan(code: string): Promise<ProviderResult<{ amountMinor: number; currency: string }>>;
  disableSubscription(code: string, emailToken: string): Promise<ProviderResult<null>>;
  manageLink(code: string): Promise<ProviderResult<{ link: string }>>;
}

/** Paystack references and codes are URL-safe tokens; anything else is refused before a call. */
const SAFE_TOKEN = /^[A-Za-z0-9_.=-]{1,200}$/;

export function createPaystackClient(
  config: Pick<PaystackConfig, "secretKey">,
  fetchImpl: FetchLike = fetch,
  baseUrl: string = PAYSTACK_BASE_URL,
): PaystackClient {
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" };
  const get = <S extends z.ZodType>(path: string, schema: S) =>
    callJson(fetchImpl, `${baseUrl}${path}`, { method: "GET", headers }, schema);
  const post = <S extends z.ZodType>(path: string, body: unknown, schema: S) =>
    callJson(fetchImpl, `${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) }, schema);

  return {
    async initializeTransaction(input) {
      const result = await post(
        "/transaction/initialize",
        {
          email: input.email,
          amount: input.amountMinor,
          plan: input.planCode,
          reference: input.reference,
          callback_url: input.callbackUrl,
          currency: "NGN",
          metadata: input.metadata,
        },
        envelope(z.object({ authorization_url: z.url() }).loose()),
      );
      return result.ok ? { ok: true, data: { authorizationUrl: result.data.data.authorization_url } } : result;
    },

    async verifyTransaction(reference) {
      if (!SAFE_TOKEN.test(reference)) return providerFail("invalid_reference", false);
      const result = await get(`/transaction/verify/${encodeURIComponent(reference)}`, envelope(transactionSchema));
      if (!result.ok) return result;
      const raw = result.data.data;
      return {
        ok: true,
        data: {
          id: String(raw.id),
          status: raw.status,
          reference: raw.reference,
          amountMinor: raw.amount,
          currency: raw.currency,
          customerId: String(raw.customer.id),
          customerCode: raw.customer.customer_code,
          planCode: planCodeOf(raw),
        },
      };
    },

    async fetchSubscription(code) {
      if (!SAFE_TOKEN.test(code)) return providerFail("invalid_code", false);
      const result = await get(`/subscription/${encodeURIComponent(code)}`, envelope(subscriptionSchema));
      return result.ok ? { ok: true, data: toSubscription(result.data.data) } : result;
    },

    async listSubscriptions(customerId) {
      if (!SAFE_TOKEN.test(customerId)) return providerFail("invalid_code", false);
      const result = await get(
        `/subscription?customer=${encodeURIComponent(customerId)}&perPage=50`,
        envelope(z.array(subscriptionSchema)),
      );
      return result.ok ? { ok: true, data: result.data.data.map(toSubscription) } : result;
    },

    async fetchPlan(code) {
      if (!SAFE_TOKEN.test(code)) return providerFail("invalid_code", false);
      const result = await get(
        `/plan/${encodeURIComponent(code)}`,
        envelope(z.object({ amount: z.number().int(), currency: z.string() }).loose()),
      );
      return result.ok
        ? { ok: true, data: { amountMinor: result.data.data.amount, currency: result.data.data.currency } }
        : result;
    },

    async disableSubscription(code, emailToken) {
      const result = await post(
        "/subscription/disable",
        { code, token: emailToken },
        z.object({ status: z.literal(true) }).loose(),
      );
      return result.ok ? { ok: true, data: null } : result;
    },

    async manageLink(code) {
      if (!SAFE_TOKEN.test(code)) return providerFail("invalid_code", false);
      const result = await get(
        `/subscription/${encodeURIComponent(code)}/manage/link`,
        envelope(z.object({ link: z.url() }).loose()),
      );
      return result.ok ? { ok: true, data: { link: result.data.data.link } } : result;
    },
  };
}

/**
 * Paystack signs each webhook with `x-paystack-signature`: the hex
 * HMAC-SHA512 of the raw request body, keyed with the secret key. Compared in
 * constant time. The body must be the exact bytes received, not re-serialized.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
