import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (sel) => document.querySelector(sel);

/* ---------- PWA: service worker + install button ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW failed', e));
  });
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('#install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  $('#install').hidden = true;
});
$('#install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#install').hidden = true;
});

/* ---------- Config check ---------- */
if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
  $('#setup').hidden = false;
} else {
  start();
}

function start() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  /* ---------- State ---------- */
  let user = null;
  let tasks = [];
  let filter = 'all';
  let editingId = null;
  let channel = null;
  let mode = 'signin'; // or 'signup'

  /* ---------- Helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  function setStatus(kind, text) {
    const s = $('#status');
    s.classList.toggle('live', kind === 'live');
    s.classList.toggle('off', kind === 'off');
    s.querySelector('span').textContent = text;
  }

  function sorted(list) {
    return [...list].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  /* ---------- Auth UI ---------- */
  function setMode(m) {
    mode = m;
    const signup = m === 'signup';
    $('#auth-title').textContent = signup ? 'Create account' : 'Sign in';
    $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
    $('#auth-toggle').textContent = signup ? 'Have an account? Sign in' : 'No account? Create one';
    $('#password').autocomplete = signup ? 'new-password' : 'current-password';
    authMsg('');
  }
  function authMsg(text, isError = false) {
    const m = $('#auth-msg');
    m.textContent = text;
    m.classList.toggle('error', isError);
  }

  $('#auth-toggle').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    if (!email || password.length < 6) {
      authMsg('Enter an email and a password of at least 6 characters.', true);
      return;
    }
    const btn = $('#auth-submit');
    btn.disabled = true;
    authMsg('Working…');
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) authMsg('Check your email to confirm your account, then sign in.');
        else authMsg('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        authMsg('');
      }
    } catch (err) {
      authMsg(err.message || 'Something went wrong.', true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#signout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  /* ---------- Session handling ---------- */
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null;
    if ((next?.id ?? null) === (user?.id ?? null)) {
      user = next; // token refresh etc.
      return;
    }
    user = next;
    // Defer: don't call supabase from inside the auth callback.
    setTimeout(() => (user ? showApp() : showAuth()), 0);
  });

  function showAuth() {
    teardownRealtime();
    tasks = [];
    editingId = null;
    $('#app').hidden = true;
    $('#auth').hidden = false;
    $('#password').value = '';
    setMode('signin');
  }

  async function showApp() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    setStatus('', 'Connecting…');
    await loadTasks();
    subscribeRealtime();
  }

  /* ---------- Data ---------- */
  async function loadTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast('Could not load tasks: ' + error.message);
      return;
    }
    tasks = data;
    render();
  }

  function subscribeRealtime() {
    teardownRealtime();
    channel = supabase
      .channel('tasks-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatus('live', 'Live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setStatus('off', 'Offline');
      });
  }

  function teardownRealtime() {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  function onChange(payload) {
    const { eventType, new: n, old: o } = payload;
    if (eventType === 'INSERT') {
      if (!tasks.some((t) => t.id === n.id)) tasks.unshift(n);
    } else if (eventType === 'UPDATE') {
      tasks = tasks.map((t) => (t.id === n.id ? n : t));
    } else if (eventType === 'DELETE') {
      tasks = tasks.filter((t) => t.id !== o.id);
    }
    render();
  }

  // Resync when the app comes back to the foreground or the network returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && user) loadTasks();
  });
  window.addEventListener('online', () => {
    if (!user) return;
    loadTasks();
    subscribeRealtime();
  });
  window.addEventListener('offline', () => setStatus('off', 'Offline'));

  /* ---------- Actions ---------- */
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#new-title');
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    const { data, error } = await supabase.from('tasks').insert({ title }).select().single();
    if (error) {
      input.value = title;
      toast('Could not add task: ' + error.message);
      return;
    }
    if (!tasks.some((t) => t.id === data.id)) tasks.unshift(data);
    render();
  });

  async function toggle(task) {
    const prev = task.done;
    task.done = !prev;
    render();
    const { error } = await supabase.from('tasks').update({ done: task.done }).eq('id', task.id);
    if (error) {
      task.done = prev;
      render();
      toast('Could not update task.');
    }
  }

  async function remove(task) {
    const before = tasks;
    tasks = tasks.filter((t) => t.id !== task.id);
    render();
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      tasks = before;
      render();
      toast('Could not delete task.');
    }
  }

  async function rename(task, title) {
    title = title.trim();
    editingId = null;
    if (!title || title === task.title) {
      render();
      return;
    }
    const prev = task.title;
    task.title = title;
    render();
    const { error } = await supabase.from('tasks').update({ title }).eq('id', task.id);
    if (error) {
      task.title = prev;
      render();
      toast('Could not rename task.');
    }
  }

  $('#clear-done').addEventListener('click', async () => {
    const done = tasks.filter((t) => t.done);
    if (!done.length) return;
    if (!confirm(`Delete ${done.length} completed task${done.length === 1 ? '' : 's'}?`)) return;
    const before = tasks;
    tasks = tasks.filter((t) => !t.done);
    render();
    const { error } = await supabase.from('tasks').delete().in('id', done.map((t) => t.id));
    if (error) {
      tasks = before;
      render();
      toast('Could not clear completed tasks.');
    }
  });

  document.querySelectorAll('.filters button').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    })
  );

  /* ---------- Rendering (textContent only, so no HTML injection) ---------- */
  function render() {
    const list = $('#list');
    list.replaceChildren();

    const visible = sorted(tasks).filter((t) =>
      filter === 'all' ? true : filter === 'active' ? !t.done : t.done
    );

    for (const task of visible) {
      const li = document.createElement('li');
      li.className = 'item' + (task.done ? ' done' : '');

      const check = document.createElement('button');
      check.className = 'check';
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', String(task.done));
      check.setAttribute('aria-label', 'Mark complete');
      const mark = document.createElement('span');
      mark.textContent = '✓';
      check.append(mark);
      check.addEventListener('click', () => toggle(task));
      li.append(check);

      if (editingId === task.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 500;
        input.value = task.title;
        input.setAttribute('aria-label', 'Edit task');
        let finished = false;
        const finish = (save) => {
          if (finished) return;
          finished = true;
          if (save) rename(task, input.value);
          else {
            editingId = null;
            render();
          }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        li.append(input);
        list.append(li);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
        continue;
      }

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = task.title;
      li.append(title);

      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.setAttribute('aria-label', 'Edit task');
      edit.textContent = '✎';
      edit.addEventListener('click', () => {
        editingId = task.id;
        render();
      });

      const del = document.createElement('button');
      del.className = 'icon-btn del';
      del.setAttribute('aria-label', 'Delete task');
      del.textContent = '✕';
      del.addEventListener('click', () => remove(task));

      li.append(edit, del);
      list.append(li);
    }

    const empty = $('#empty');
    empty.hidden = visible.length > 0;
    empty.textContent =
      tasks.length === 0 ? 'Nothing to do. Add your first task above.' :
      filter === 'done' ? 'No completed tasks yet.' : 'All caught up. 🎉';

    const remaining = tasks.filter((t) => !t.done).length;
    $('#count').textContent = `${remaining} task${remaining === 1 ? '' : 's'} left`;
    $('#clear-done').hidden = !tasks.some((t) => t.done);
  }
}
