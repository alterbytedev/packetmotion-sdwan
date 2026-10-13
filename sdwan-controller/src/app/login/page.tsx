import { redirect } from 'next/navigation';
import {
  Activity,
  ArrowUpRight,
  Globe2,
  LockKeyhole,
  Network,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { sessionSecret, getUser } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';

export default async function LoginPage() {
  if (await getUser()) redirect('/dashboard');
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
      <section className="grid-surface relative hidden overflow-hidden bg-[#112f2b] p-12 text-white lg:flex lg:flex-col xl:p-16">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
            <Network size={23} />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            SD-WAN<span className="ml-2 font-normal text-white/50">Controller</span>
          </span>
        </div>
        <div className="relative z-10 my-auto py-12">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-xs text-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-300" /> YOUR NETWORK. CONNECTED.
          </div>
          <h1 className="max-w-lg text-5xl font-medium leading-[1.15] tracking-tight xl:text-6xl">
            Every branch.
            <br />
            One clear view.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-white/55">
            A central workspace for your distributed network. Connect branches, manage
            configurations, and keep operations in focus.
          </p>
          <div
            className="relative mt-10 flex h-44 max-w-md items-center justify-center"
            aria-hidden="true"
          >
            <div className="absolute h-36 w-80 rounded-[50%] border border-emerald-200/15" />
            <div className="absolute h-24 w-56 rounded-[50%] border border-emerald-200/10" />
            <div className="absolute left-4 top-7 flex size-11 items-center justify-center rounded-xl border border-white/15 bg-[#1b4039]">
              <Radio size={20} className="text-emerald-200" />
            </div>
            <div className="absolute bottom-7 right-5 flex size-11 items-center justify-center rounded-xl border border-white/15 bg-[#1b4039]">
              <Globe2 size={20} className="text-emerald-200" />
            </div>
            <div className="flex size-20 items-center justify-center rounded-2xl border border-emerald-200/30 bg-[#1d5144] shadow-[0_0_60px_#34d39920]">
              <Network size={36} className="text-emerald-200" />
            </div>
            <div className="absolute right-6 top-1 flex items-center gap-2 rounded-lg border border-white/10 bg-[#163a32] px-3 py-2 text-[11px] text-white/60">
              <Activity size={14} /> Centralized control
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-6 text-xs text-white/40">
          <span>Built for distributed networks</span>
          <ShieldCheck size={16} />
        </div>
      </section>
      <section className="flex min-h-screen flex-col bg-[#fbfcfc] px-6 py-8 sm:px-12">
        <div className="flex items-center gap-2 font-semibold text-primary lg:hidden">
          <Network size={24} /> SD-WAN Controller
        </div>
        <div className="my-auto w-full max-w-[380px] self-center py-12">
          <div className="mb-7 flex size-12 items-center justify-center rounded-xl border bg-white shadow-sm">
            <LockKeyhole size={22} className="text-primary" />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mb-8 mt-3 text-sm leading-6 text-muted-foreground">
            Sign in to manage your SD-WAN network.
          </p>
          <LoginForm configured={Boolean(sessionSecret())} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>SD-WAN Controller</span>
          <span className="flex items-center gap-1">
            Operator workspace <ArrowUpRight size={12} />
          </span>
        </div>
      </section>
    </main>
  );
}
