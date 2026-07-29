export type MutationHandler = (addedNodes: Node[]) => void;

export class DynamicContentObserver {
  private observer: MutationObserver | null = null;
  private onMutations: MutationHandler;

  constructor(onMutations: MutationHandler) {
    this.onMutations = onMutations;
  }

  start(root: Node = document.body): void {
    this.stop();
    this.observer = new MutationObserver((mutations) => {
      const added: Node[] = [];
      for (const m of mutations) {
        m.addedNodes.forEach((n) => added.push(n));
      }
      if (added.length) this.onMutations(added);
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
