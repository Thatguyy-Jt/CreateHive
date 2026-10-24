"use client";

import { useClerk } from "@clerk/nextjs";
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "@/app/app/settings/actions";

const IDLE: DeleteAccountState = { status: "idle", message: null };

/** Deletes the account after a second step and a typed `DELETE`. Success signs out to the homepage. */
export function DeleteAccountControl({ hasRenewingPlan }: { hasRenewingPlan: boolean }) {
  const [state, action, pending] = useActionState(deleteAccountAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const keepButton = useRef<HTMLButtonElement>(null);
  const { signOut } = useClerk();
  const deleted = state.status === "deleted";

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (deleted) void signOut({ redirectUrl: "/" });
  }, [deleted, signOut]);

  return (
    <section className="stack-sm border-t border-border pt-6" aria-labelledby="settings-delete">
      <h3 id="settings-delete" className="text-base font-bold">
        Delete your account
      </h3>
      {deleted ? (
        <p role="status" className="font-semibold">
          Account deleted. Signing you out…
        </p>
      ) : confirming ? (
        <form action={action} className="stack-sm" aria-busy={pending}>
          <p role="alert" className="font-semibold">
            {hasRenewingPlan
              ? "This deletes your account and all your data, and stops your Pro renewal. Your remaining paid time ends now and isn't refunded. Download your data first if you want a copy."
              : "This deletes your account and all your data. Download your data first if you want a copy."}
          </p>
          <div className="field">
            <label htmlFor="delete-confirmation" className="field-label">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirmation"
              name="confirmation"
              className="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-2 min-[480px]:flex-row">
            <button
              type="submit"
              className="btn btn-primary btn-sm w-full min-[480px]:w-auto"
              disabled={pending || typed.trim() !== "DELETE"}
            >
              {pending ? "Deleting…" : "Delete my account"}
            </button>
            <button
              ref={keepButton}
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              disabled={pending}
            >
              Keep my account
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="field-help">Permanently deletes your account and everything listed above. This can&apos;t be undone.</p>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(true)}
            >
              Delete account…
            </button>
          </div>
        </>
      )}
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
