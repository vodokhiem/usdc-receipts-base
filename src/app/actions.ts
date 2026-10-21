"use server";

import { redirect } from "next/navigation";
import { addWatched } from "@/lib/queries";

export async function watchAddress(formData: FormData) {
  const raw = String(formData.get("address") ?? "").trim();
  const label = String(formData.get("label") ?? "");
  const address = await addWatched(raw, label);
  redirect(`/a/${address}`);
}
