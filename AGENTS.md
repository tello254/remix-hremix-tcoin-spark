<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Application architecture
- Keep the Tcoins preview in a shared React context with in-memory state; this prevents accidental real verification or payments before service integration.
- Render each content page as its own TanStack leaf route using a shared application shell and feature views; this preserves navigation and per-page metadata.
- Centralize reward validation and currency calculations in a browser-safe module so simulated flows use the same financial rules.
