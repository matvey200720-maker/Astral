package bridge

import "encoding/json"

const hostPrefix = "window.__astralHost."

// argList кодирует аргументы вызова одним списком JSON и снимает внешние
// скобки. Кодировщик стандартный: знаки <, >, & и U+2028/U+2029 уходят
// текстом-экранированием, поэтому вставка в скрипт безопасна.
func argList(vals ...any) (list string, err error) {
	var packed []byte
	if packed, err = json.Marshal(vals); err == nil {
		list = string(packed[1 : len(packed)-1])
	}
	return
}

// hostScript строит вызов приёмника window.__astralHost: handler — имя его
// метода (_r или _e), vals — аргументы вызова.
func hostScript(handler string, vals ...any) (script string, err error) {
	var args string
	if args, err = argList(vals...); err == nil {
		script = hostPrefix + handler + "(" + args + ")"
	}
	return
}

// EventScript строит скрипт доставки события странице. Ошибка — только если
// не кодируются данные.
func EventScript(event string, data any) (string, error) {
	return hostScript("_e", event, data)
}

// ReplyScript строит скрипт доставки ответа на вызов id. Ошибка — только если
// payload не кодируется в JSON.
func ReplyScript(id int64, ok bool, payload any) (string, error) {
	return hostScript("_r", id, ok, payload)
}

// ShimJS вставляется в каждую страницу раньше её собственных скриптов. Внутри
// WebView2 он определяет window.astralBridge (call, on) и скрытый приёмник
// window.__astralHost (_r, _e); без WebView2 ничего не делает.
const ShimJS = `(function () {
  'use strict';
  if (!window.chrome || !window.chrome.webview || window.astralBridge) {
    return;
  }
  var channel = window.chrome.webview;
  var waiting = Object.create(null);
  var topics = Object.create(null);
  var counter = 0;

  function call(method, params) {
    var id = ++counter;
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      try {
        channel.postMessage(JSON.stringify({
          id: id,
          m: String(method),
          p: params === undefined ? {} : params
        }));
      } catch (err) {
        delete waiting[id];
        reject({ code: 'INTERNAL', retryable: false, detail: String(err) });
      }
    });
  }

  function on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('astralBridge.on: handler must be a function');
    }
    var list = topics[event];
    if (!list) {
      list = topics[event] = [];
    }
    var entry = { fn: handler };
    list.push(entry);
    return function off() {
      var at = list.indexOf(entry);
      if (at >= 0) {
        list.splice(at, 1);
      }
    };
  }

  function settle(id, ok, value) {
    var entry = waiting[id];
    if (!entry) {
      return;
    }
    delete waiting[id];
    if (ok) {
      entry.resolve(value);
    } else {
      entry.reject(value);
    }
  }

  function emit(event, data) {
    var list = topics[event];
    if (!list) {
      return;
    }
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i].fn(data);
      } catch (err) {
        console.error('astralBridge: handler of ' + event + ' failed', err);
      }
    }
  }

  // Своя страница — только ровно того же происхождения: адрес, который лишь начинается с origin окна
  // (чужой домен с таким префиксом, логин в адресе, другой порт), открывать внутри окна нельзя.
  function isOwnPage(href) {
    try {
      return new URL(href).origin === location.origin;
    } catch (err) {
      return false;
    }
  }

  function openOutside(url) {
    call('openExternal', { url: url }).catch(function () {});
  }

  Object.defineProperty(window, 'astralBridge', {
    value: Object.freeze({ version: 1, call: call, on: on }),
    enumerable: true
  });
  Object.defineProperty(window, '__astralHost', {
    value: Object.freeze({ _r: settle, _e: emit })
  });

  document.addEventListener('click', function (event) {
    var target = event && event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    var link = target.closest('a[href]');
    if (!link) {
      return;
    }
    var href = link.getAttribute('href') || '';
    if (/^(?:https?|mailto):/i.test(href) && !isOwnPage(href)) {
      event.preventDefault();
      openOutside(href);
    }
  }, true);

  window.open = function (url) {
    if (url) {
      openOutside(String(url));
    }
    return null;
  };

  function keepPage(event) {
    event.preventDefault();
  }
  window.addEventListener('dragover', keepPage);
  window.addEventListener('drop', keepPage);
})();
`
