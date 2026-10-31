import type { Person } from "../types";
import { request } from "./api";
import { toWav } from "./audio";
export async function loadPeople(): Promise<Person[]> {
  const profiles = await request<{ id: string; name: string }[]>("/api/profiles");
  return profiles.map((p) => ({ ...p, role: "room" }));
}
export async function savePerson(person: Person, replaceId?: string): Promise<Person> {
  if (!person.clip) throw new Error("Record or upload a voice sample first.");
  const body = new FormData();
  body.append("name", person.name);
  body.append("file", await toWav(person.clip), "voice-sample.wav");
  const saved = await request<{ id: string; name: string }>(replaceId ? `/api/profiles/${encodeURIComponent(replaceId)}` : "/api/profiles", { method: replaceId ? "PUT" : "POST", body });
  return { ...saved, role: person.role };
}
export const removePerson = (id: string) => request(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
