// Custom action for reliable autofocus
export function focusOnMount(node: HTMLElement) {
  // Focus immediately
  node.focus();
  
  // Also focus after a short delay to handle dynamic rendering
  setTimeout(() => {
    node.focus();
  }, 100);
  
  return {
    destroy() {
      // Cleanup if needed
    }
  };
}

// Enhanced version that also handles Enter key submission
export function focusOnMountWithEnter(node: HTMLElement, callback: () => void) {
  // Focus immediately
  node.focus();
  
  // Also focus after a short delay to handle dynamic rendering
  setTimeout(() => {
    node.focus();
  }, 100);
  
  // Add Enter key handler
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      callback();
    }
  };
  
  node.addEventListener('keydown', handleKeydown);
  
  return {
    destroy() {
      node.removeEventListener('keydown', handleKeydown);
    }
  };
} 