import { redirect } from "next/navigation";

/** Jobs moved into Career; old links and bookmarks still land there. */
export default function JobsMoved() {
  redirect("/life/career/jobs");
}
