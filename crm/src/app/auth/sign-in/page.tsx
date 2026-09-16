import Image from "next/image";
import { GHOST_TIMING_LOGO_WHITE } from "@/lib/branding";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <Image
            src={GHOST_TIMING_LOGO_WHITE}
            alt="Ghost Timing"
            width={192}
            height={192}
            className="mx-auto h-24 w-auto"
            priority
          />
          <h1 className="mt-4 text-2xl font-bold">Race CRM</h1>
        </div>
        <p className="mb-6 text-sm leading-6 text-slate-300">
          Sign in with an approved Google account to work with leads and tasks.
        </p>
        <GoogleSignInButton />
      </section>
    </main>
  );
}
