import React, { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

interface Props {
  serverError?: string | null;
  /** The emailed link's token, passed through unused; absent for a signed-in retry. */
  tokenHash?: string;
  type?: string;
}

export default function SetPasswordForm({ serverError, tokenHash, type }: Props) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function validate() {
    let next: string | undefined;
    if (!password) {
      next = "Password is required";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    setError(next);
    return next === undefined;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !error && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-muted-foreground mt-1 text-xs">
        {MIN_PASSWORD_LENGTH - password.length} more character
        {MIN_PASSWORD_LENGTH - password.length !== 1 ? "s" : ""} needed
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/set-password" className="space-y-4" onSubmit={handleSubmit} noValidate>
      {tokenHash && type ? (
        <>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
        </>
      ) : null}

      <FormField
        id="password"
        label="New password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          if (error) setError(undefined);
        }}
        placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
        error={error}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Saving..." icon={<KeyRound className="size-4" />}>
        Save password
      </SubmitButton>
    </form>
  );
}
