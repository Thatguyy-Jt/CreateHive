import { describe, expect, it, vi } from "vitest";
import { createPaystackClient, verifyPaystackSignature } from "@/lib/billing/paystack";

// Vectors computed independently with `openssl dgst -sha512 -hmac <key>`.
const PAYSTACK_BODY = '{"event":"charge.success","data":{"reference":"ch_1"}}';
const PAYSTACK_SIG =
  "b958248104ce5242879d3ce06153de179563eb19dd77cb29b2ec0a29f052b7c0e5f6cc589952c010a186c13ed294892b548730d505084db7c8c817d628ec096e";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("verifyPaystackSignature", () => {
  it("accepts the HMAC-SHA512 of the raw body", () => {
    expect(verifyPaystackSignature(PAYSTACK_BODY, PAYSTACK_SIG, "sk_test_secret")).toBe(true);
    expect(verifyPaystackSignature(PAYSTACK_BODY, PAYSTACK_SIG.toUpperCase(), "sk_test_secret")).toBe(true);
  });

  it.each([
    ["a missing header", PAYSTACK_BODY, null, "sk_test_secret"],
    ["an empty header", PAYSTACK_BODY, "", "sk_test_secret"],
    ["the wrong key", PAYSTACK_BODY, PAYSTACK_SIG, "sk_test_other"],
    ["a changed body", PAYSTACK_BODY.replace("ch_1", "ch_2"), PAYSTACK_SIG, "sk_test_secret"],
    ["re-serialized JSON", JSON.stringify(JSON.parse(PAYSTACK_BODY), null, 1), PAYSTACK_SIG, "sk_test_secret"],
    ["a truncated signature", PAYSTACK_BODY, PAYSTACK_SIG.slice(0, 64), "sk_test_secret"],
    ["non-hex", PAYSTACK_BODY, "z".repeat(128), "sk_test_secret"],
  ])("rejects %s", (_label, body, signature, key) => {
    expect(verifyPaystackSignature(body, signature, key)).toBe(false);
  });
});

describe("Paystack client", () => {
  it("initializes a plan checkout with the secret key and returns the hosted URL", async () => {
    const fetchImpl = vi.fn(async () => json({ status: true, data: { authorization_url: "https://checkout.paystack.com/x" } }));
    const client = createPaystackClient({ secretKey: "sk_test_secret" }, fetchImpl);

    const result = await client.initializeTransaction({
      email: "c@example.com",
      amountMinor: 500_000,
      planCode: "PLN_pro",
      reference: "ch_1",
      callbackUrl: "https://app.test/app/billing/return",
      metadata: { plan: "pro" },
    });

    expect(result).toEqual({ ok: true, data: { authorizationUrl: "https://checkout.paystack.com/x" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 500_000, plan: "PLN_pro", reference: "ch_1", currency: "NGN" });
  });

  it("reads verify responses whether `plan` is a code or an object", async () => {
    const base = { id: 9, status: "success", reference: "ch_1", amount: 500_000, currency: "NGN", customer: { id: 7, customer_code: "CUS_1" } };
    for (const plan of ["PLN_pro", { plan_code: "PLN_pro" }]) {
      const client = createPaystackClient({ secretKey: "k" }, async () => json({ status: true, data: { ...base, plan } }));
      await expect(client.verifyTransaction("ch_1")).resolves.toEqual({
        ok: true,
        data: {
          id: "9",
          status: "success",
          reference: "ch_1",
          amountMinor: 500_000,
          currency: "NGN",
          customerId: "7",
          customerCode: "CUS_1",
          planCode: "PLN_pro",
        },
      });
    }
  });

  it("refuses unsafe references without calling Paystack", async () => {
    const fetchImpl = vi.fn();
    const client = createPaystackClient({ secretKey: "k" }, fetchImpl);
    await expect(client.verifyTransaction("../plan/x")).resolves.toMatchObject({ ok: false, transient: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps failures to safe codes and marks 5xx and network errors as transient", async () => {
    const reject = createPaystackClient({ secretKey: "k" }, async () => json({ status: false, message: "Invalid key" }, 401));
    await expect(reject.fetchSubscription("SUB_1")).resolves.toEqual({ ok: false, code: "http_401", transient: false });

    const down = createPaystackClient({ secretKey: "k" }, async () => json({ status: false }, 503));
    await expect(down.fetchSubscription("SUB_1")).resolves.toEqual({ ok: false, code: "http_503", transient: true });

    const offline = createPaystackClient({ secretKey: "k" }, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.fetchSubscription("SUB_1")).resolves.toEqual({ ok: false, code: "network", transient: true });

    const odd = createPaystackClient({ secretKey: "k" }, async () => json({ status: true, data: { nope: 1 } }));
    await expect(odd.fetchSubscription("SUB_1")).resolves.toEqual({ ok: false, code: "invalid_response", transient: false });
  });
});
