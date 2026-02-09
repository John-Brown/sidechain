let activeProjectId = $state<string | null>(null);
let activeProjectName = $state<string | null>(null);
let activeProjectRole = $state<string | null>(null);

export function getActiveProject() {
  return {
    get id() {
      return activeProjectId;
    },
    get name() {
      return activeProjectName;
    },
    get role() {
      return activeProjectRole;
    },
  };
}

export function setActiveProject(id: string, name: string, role?: string) {
  activeProjectId = id;
  activeProjectName = name;
  activeProjectRole = role ?? null;
}

export function clearActiveProject() {
  activeProjectId = null;
  activeProjectName = null;
  activeProjectRole = null;
}
