import { db } from "./Firebase.js";
import { doc, getDoc, setDoc } from "firebase/firestore";

const UID = "O1b10rk4P9Sz8vUtSNr8Ucrp3ni1";

export async function peek() {
  const ref = doc(db, "users", UID);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function sanitize() {
  const ref = doc(db, "users", UID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { error: "no doc" };
  const data = snap.data();

  const nameMap = { Payton: "CG5", Hayden: "CG3" };
  const newChildren = (data.children || []).map(c =>
    nameMap[c.name] ? { ...c, name: nameMap[c.name] } : c
  );

  const patch = { children: newChildren, familyLastName: "Smith" };
  await setDoc(ref, patch, { merge: true });

  const verifySnap = await getDoc(ref);
  return { before: data, patch, after: verifySnap.data() };
}
