// AIに聞かれる宿 診断 サンプル: コード例のコピーと、対策前後のサイトの読み込み
(function () {
  "use strict";

  function copyWithSelection(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "absolute";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    document.body.removeChild(area);
    return copied;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return copyWithSelection(text); }
      );
    }
    return Promise.resolve(copyWithSelection(text));
  }

  function selectCode(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.querySelectorAll("[data-copy-target]").forEach(function (button) {
    var label = button.textContent;
    button.addEventListener("click", function () {
      var target = document.getElementById(button.getAttribute("data-copy-target"));
      if (!target) return;
      copyText(target.textContent).then(function (copied) {
        if (copied) {
          button.textContent = "コピーしました";
        } else {
          selectCode(target);
          button.textContent = "選択しました。Ctrl+Cでコピーしてください";
        }
        window.setTimeout(function () { button.textContent = label; }, 2500);
      });
    });
  });

  // 対策前後のサイトは、押されたときだけこのページ内に読み込む（読者が見ていない間は通信しない）。
  document.querySelectorAll("[data-frame-src]").forEach(function (button) {
    button.addEventListener("click", function () {
      var screen = button.parentNode;
      var frame = document.createElement("iframe");
      frame.src = button.getAttribute("data-frame-src");
      frame.title = button.getAttribute("data-frame-title");
      screen.classList.add("is-live");
      screen.replaceChildren(frame);
      frame.focus();
    });
  });
})();
