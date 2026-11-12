/** Static markup only. Every value from the library is rendered with textContent. */
export function renderLibraryShell(): string {
  return `
    <aside class="sidebar" aria-label="Navegação principal">
      <a class="brand" href="./" aria-label="PKM, início"><span class="brand-mark" aria-hidden="true">k.</span><span>PKM<span class="brand-caption">sua biblioteca pessoal</span></span></a>
      <div class="sidebar-section">SEU CONHECIMENTO</div>
      <a class="sidebar-current library-nav" href="./" aria-current="page"><span class="nav-dot" aria-hidden="true"></span> Sua biblioteca <span class="tiny-badge" id="sidebar-count">0</span></a>
      <a class="library-nav library-nav-secondary" href="?view=lab"><span aria-hidden="true">⌁</span> Diagnóstico</a>
      <p class="sidebar-description">Uma receita para experimentar.<br>Um prompt para reutilizar.<br>Um lugar para encontrar tudo.</p>
      <div class="library-sidebar-note"><span class="step-label">COMECE PEQUENO</span><p>Guarde o que importa hoje.<br>Seu conhecimento cresce com você.</p></div>
      <div class="local-note"><span class="local-note-icon" aria-hidden="true">↳</span><strong>Seu espaço, neste dispositivo.</strong><p>Seus conteúdos ficam salvos localmente. Cada navegador e dispositivo tem sua própria biblioteca.</p></div>
      <div class="sidebar-footer">BIBLIOTECA PESSOAL <span id="library-version"></span></div>
    </aside>
    <div class="workspace library-workspace">
      <header class="topbar library-topbar"><span class="breadcrumb"><span class="mobile-brand">PKM / </span>Seu espaço <span aria-hidden="true">/</span> <span id="library-breadcrumb">Biblioteca</span></span><a class="library-mobile-diagnostics" href="?view=lab">Diagnóstico</a><span class="phase-tag"><span aria-hidden="true">●</span> Armazenamento local</span></header>
      <main id="main" class="main library-main" tabindex="-1">
        <div class="page-heading library-heading"><div><p class="eyebrow">UM LUGAR PARA SUAS IDEIAS</p><h1 id="library-title" tabindex="-1">Sua biblioteca</h1><p class="page-description" id="library-description">Guarde, organize e retome o que você quer aprender.</p></div><div class="library-heading-actions"><button type="button" class="button button-secondary" id="library-backup-open" data-testid="backup-open" disabled>Backup e restauração</button><button type="button" class="button button-primary" id="new-content" data-testid="new-content" disabled><span aria-hidden="true">＋</span> Novo conteúdo</button></div></div>
        <div class="library-system-state" aria-label="Estado da biblioteca"><span><span class="state-dot" id="library-db-dot" aria-hidden="true"></span> <span id="library-db-state" data-testid="db-status">Abrindo biblioteca…</span></span><span id="offline-status" data-testid="offline-status">Preparando uso offline…</span><span id="library-connection"></span></div>
        <div class="notice notice-error" id="library-error" data-testid="library-error" role="alert" hidden></div>
        <button type="button" class="button button-secondary library-retry" id="library-retry" data-testid="library-retry" hidden>Tentar novamente</button>
        <div class="notice notice-success" id="library-success" data-testid="library-success" role="status" aria-live="polite" hidden></div>
        <section id="library-list" data-testid="library-list" aria-label="Conteúdos salvos" aria-live="polite"><div class="panel library-loading"><p>Preparando seu espaço…</p></div></section>
        <section id="library-editor-container" hidden aria-label="Cadastro de conteúdo"></section>
        <div class="storage-warning"><span aria-hidden="true">ⓘ</span><p><strong>Cuide da sua biblioteca local.</strong> Limpar os dados do navegador ou remover o aplicativo pode apagar seus conteúdos. Exporte um backup JSON e guarde o arquivo fora do navegador para poder restaurar depois.</p></div>
        <footer class="main-footer"><span>PKM · seu conhecimento, por perto</span><div><span id="pwa-message" aria-live="polite">Preparando aplicação…</span><button type="button" id="library-check-update" class="button button-text" disabled>Verificar atualização</button><button type="button" id="library-apply-update" class="button button-primary" hidden>Aplicar atualização</button></div></footer>
      </main>
    </div>`;
}

