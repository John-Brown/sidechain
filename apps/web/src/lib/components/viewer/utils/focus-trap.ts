const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Creates a focus trap within a dialog element.
 * Returns a cleanup function that removes all event listeners.
 */
export function createFocusTrap(dialogEl: HTMLElement): () => void {
	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const focusable = dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
	dialogEl.addEventListener('keydown', handleKeydown);
	const firstFocusable = dialogEl.querySelector<HTMLElement>(FOCUSABLE);
	if (firstFocusable) firstFocusable.focus();
	return () => dialogEl.removeEventListener('keydown', handleKeydown);
}

/**
 * All-in-one dialog a11y setup: focus trap + capture-phase Escape + previous element restore.
 * Returns cleanup function for onDestroy/onMount cleanup.
 */
export function createDialogA11y(dialogEl: HTMLElement, onClose: () => void): () => void {
	const previouslyFocused = document.activeElement as HTMLElement | null;
	const cleanupTrap = createFocusTrap(dialogEl);

	function handleEscape(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onClose();
		}
	}
	// Use capture phase so viewer's own Escape handler doesn't fire
	document.addEventListener('keydown', handleEscape, true);

	return () => {
		cleanupTrap();
		document.removeEventListener('keydown', handleEscape, true);
		previouslyFocused?.focus();
	};
}
