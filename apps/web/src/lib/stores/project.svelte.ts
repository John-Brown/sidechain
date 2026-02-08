let activeProjectId = $state<string | null>(null);
let activeProjectName = $state<string | null>(null);

export function getActiveProject() {
  return {
    get id() {
      return activeProjectId;
    },
    get name() {
      return activeProjectName;
    },
  };
}

export function setActiveProject(id: string, name: string) {
  activeProjectId = id;
  activeProjectName = name;
}

export function clearActiveProject() {
  activeProjectId = null;
  activeProjectName = null;
}
