"use client";

import { useClerk } from "@clerk/nextjs";

// Profile, email, password and connected accounts are managed by Clerk.
export function ManageAccountButton() {
  const { openUserProfile } = useClerk();

  return (
    <button
      type="button"
      className="btn btn-secondary w-full min-[480px]:w-auto"
      onClick={() => openUserProfile()}
    >
      Manage account
    </button>
  );
}
