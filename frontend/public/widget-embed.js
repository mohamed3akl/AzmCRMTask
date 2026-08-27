(function () {
  function getConfig(scriptEl) {
    return {
      origin: scriptEl.getAttribute('data-origin'),
      locale: scriptEl.getAttribute('data-locale') || 'en',
      containerId: scriptEl.getAttribute('data-container') || null,
    };
  }

  function createIframe(config) {
    var iframe = document.createElement('iframe');
    iframe.src = config.origin + '/widget/embed?locale=' + config.locale;
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '480px';
    return iframe;
  }

  function mount(scriptEl) {
    var config = getConfig(scriptEl);
    if (!config.origin) {
      console.error('[azmcrm-widget] data-origin attribute is required on the embed <script> tag.');
      return null;
    }
    var iframe = createIframe(config);
    var container = config.containerId ? document.getElementById(config.containerId) : null;
    if (container) {
      container.appendChild(iframe);
    } else {
      scriptEl.insertAdjacentElement('afterend', iframe);
    }
    window.addEventListener('message', function (event) {
      if (event.origin !== config.origin) return;
      if (!event.data || event.data.source !== 'azmcrm-widget') return;
      iframe.style.height = event.data.height + 'px';
    });
    return iframe;
  }

  window.__azmcrmWidget = { getConfig: getConfig, createIframe: createIframe, mount: mount };

  if (document.currentScript) {
    mount(document.currentScript);
  }
})();
