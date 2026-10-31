import type { Person } from "../types";

// People stay in this browser's IndexedDB so enrollment only happens once.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voicesplit", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("people", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = act(db.transaction("people", mode).objectStore("people"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const loadPeople = () => run<Person[]>("readonly", (s) => s.getAll());
export const savePerson = (person: Person) => run("readwrite", (s) => s.put(person));
export const removePerson = (id: string) => run("readwrite", (s) => s.delete(id));
