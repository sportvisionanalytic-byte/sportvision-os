import { notFound } from "next/navigation";
import { getDemoProfile } from "@/lib/demo/profiles";
import { renderDemoPage } from "@/lib/demo/content";

export default async function DemoModulePage({
  params,
}: {
  params: Promise<{ profile: string; module?: string[] }>;
}) {
  const { profile: profileKey, module } = await params;
  const profile = getDemoProfile(profileKey);
  if (!profile) notFound();

  const path = module && module.length > 0 ? module.join("/") : "dashboard";
  return <>{renderDemoPage(profile, path)}</>;
}
