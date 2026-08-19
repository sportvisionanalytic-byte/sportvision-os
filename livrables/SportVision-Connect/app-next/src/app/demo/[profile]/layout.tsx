import { notFound } from "next/navigation";
import { DemoShell } from "@/components/layout/DemoShell";
import { getDemoProfile } from "@/lib/demo/profiles";

export default async function DemoProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ profile: string }>;
}) {
  const { profile: profileKey } = await params;
  const profile = getDemoProfile(profileKey);
  if (!profile) notFound();

  return <DemoShell profile={profile}>{children}</DemoShell>;
}
