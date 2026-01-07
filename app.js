import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = (window.__SUPABASE_URL__ || "").trim();
const SUPABASE_ANON_KEY = (window.__SUPABASE_ANON_KEY__ || "").trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  alert(
    "Supabase 설정이 비어있어요.\n\nindex.html <head>에 window.__SUPABASE_URL__ / window.__SUPABASE_ANON_KEY__ 주입 스크립트를 추가하거나, app.js 상단에 값을 넣어주세요."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const $ = (id) => document.getElementById(id);

const els = {
  userBox: $("userBox"),
  btnLogin: $("btnLogin"),
  btnLogout: $("btnLogout"),

  vtuberName: $("vtuberName"),
  vtuberChannel: $("vtuberChannel"),
  btnAddVtuber: $("btnAddVtuber"),
  vtuberList: $("vtuberList"),

  vtuberFilter: $("vtuberFilter"),
  postTitle: $("postTitle"),
  postBody: $("postBody"),
  btnCreatePost: $("btnCreatePost"),
  postList: $("postList")
};

let state = {
  user: null,
  profile: null,
  vtubers: [],
  posts: []
};

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { hour12: false });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireLogin() {
  if (!state.user) {
    alert("로그인이 필요해요.");
    return false;
  }
  return true;
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.user = data.session?.user || null;
  await ensureProfile();
  renderAuth();
}

async function ensureProfile() {
  if (!state.user) {
    state.profile = null;
    return;
  }
  const uid = state.user.id;
  const email = state.user.email || null;

  const { data: p1, error: e1 } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", uid)
    .maybeSingle();

  if (e1) console.warn(e1);

  if (p1) {
    state.profile = p1;
    return;
  }

  const nickname =
    state.user.user_metadata?.name ||
    state.user.user_metadata?.full_name ||
    state.user.user_metadata?.nickname ||
    (email ? email.split("@")[0] : "user");

  const { data: p2, error: e2 } = await supabase
    .from("profiles")
    .insert({
      id: uid,
      nickname,
      avatar_url: state.user.user_metadata?.avatar_url || null
    })
    .select("*")
    .single();

  if (e2) {
    console.warn(e2);
    state.profile = null;
    return;
  }
  state.profile = p2;
}

function renderAuth() {
  if (state.user) {
    const nick = state.profile?.nickname || "로그인됨";
    const email = state.user.email || "";
    els.userBox.textContent = `${nick}${email ? " · " + email : ""}`;
    els.userBox.classList.remove("hidden");
    els.btnLogin.classList.add("hidden");
    els.btnLogout.classList.remove("hidden");
  } else {
    els.userBox.classList.add("hidden");
    els.btnLogin.classList.remove("hidden");
    els.btnLogout.classList.add("hidden");
  }
}

async function loadVtubers() {
  const { data, error } = await supabase
    .from("vtubers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(error);
    alert("버튜버 목록을 불러오지 못했어요.");
    return;
  }

  state.vtubers = data || [];
  renderVtubers();
  renderVtuberFilter();
}

function renderVtuberFilter() {
  const current = els.vtuberFilter.value;
  els.vtuberFilter.innerHTML =
    `<option value="">전체</option>` +
    state.vtubers
      .map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`)
      .join("");

  if (current) els.vtuberFilter.value = current;
}

function renderVtubers() {
  if (!state.vtubers.length) {
    els.vtuberList.innerHTML = `<div class="card">아직 등록된 버튜버가 없어요.</div>`;
    return;
  }

  els.vtuberList.innerHTML = state.vtubers
    .map((v) => {
      const channel = v.channel_url
        ? `<a class="badge" href="${escapeHtml(v.channel_url)}" target="_blank" rel="noreferrer">채널</a>`
        : `<span class="badge">채널 없음</span>`;

      return `
        <div class="card">
          <div class="cardTitle">
            <span>${escapeHtml(v.name)}</span>
            ${channel}
          </div>
          <div class="cardMeta">
            <span>등록: ${fmtTime(v.created_at)}</span>
            <span>·</span>
            <button class="btn small danger" data-del-vtuber="${escapeHtml(v.id)}">삭제</button>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-del-vtuber]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      const id = btn.getAttribute("data-del-vtuber");
      if (!confirm("정말 삭제할까요? (연결된 게시글은 남습니다)")) return;

      const { error } = await supabase.from("vtubers").delete().eq("id", id);
      if (error) {
        console.warn(error);
        alert("삭제 실패: 권한 또는 정책(RLS)을 확인하세요.");
        return;
      }
      await loadVtubers();
      await loadPosts();
    });
  });
}

async function addVtuber() {
  if (!requireLogin()) return;

  const name = els.vtuberName.value.trim();
  const channel_url = els.vtuberChannel.value.trim() || null;
  if (!name) return alert("버튜버 이름을 입력하세요.");

  const { error } = await supabase.from("vtubers").insert({ name, channel_url });
  if (error) {
    console.warn(error);
    alert("추가 실패: 권한 또는 정책(RLS)을 확인하세요.");
    return;
  }

  els.vtuberName.value = "";
  els.vtuberChannel.value = "";
  await loadVtubers();
}

async function loadPosts() {
  const vtuberId = els.vtuberFilter.value || null;

  let q = supabase
    .from("posts")
    .select("*, vtubers(name), profiles(nickname, avatar_url)")
    .order("created_at", { ascending: false });

  if (vtuberId) q = q.eq("vtuber_id", vtuberId);

  const { data: posts, error } = await q;
  if (error) {
    console.warn(error);
    alert("게시글을 불러오지 못했어요.");
    return;
  }

  const postIds = (posts || []).map((p) => p.id);

  let likeMap = {};
  let myLikeSet = new Set();
  if (postIds.length) {
    const { data: likes, error: eLikes } = await supabase
      .from("likes")
      .select("post_id, user_id")
      .in("post_id", postIds);

    if (eLikes) console.warn(eLikes);

    for (const l of likes || []) {
      likeMap[l.post_id] = (likeMap[l.post_id] || 0) + 1;
      if (state.user && l.user_id === state.user.id) myLikeSet.add(l.post_id);
    }
  }

  let commentMap = {};
  if (postIds.length) {
    const { data: comments, error: eC } = await supabase
      .from("comments")
      .select("*, profiles(nickname, avatar_url)")
      .in("post_id", postIds)
      .order("created_at", { ascending: true });

    if (eC) console.warn(eC);

    for (const c of comments || []) {
      commentMap[c.post_id] = commentMap[c.post_id] || [];
      commentMap[c.post_id].push(c);
    }
  }

  state.posts = (posts || []).map((p) => ({
    ...p,
    vtuber_name: p.vtubers?.name || null,
    author_nickname: p.profiles?.nickname || "익명",
    like_count: likeMap[p.id] || 0,
    my_liked: myLikeSet.has(p.id),
    comments: commentMap[p.id] || []
  }));

  renderPosts();
}

function renderPosts() {
  if (!state.posts.length) {
    els.postList.innerHTML = `<div class="post">아직 게시글이 없어요.</div>`;
    return;
  }

  els.postList.innerHTML = state.posts
    .map((p) => {
      const vt = p.vtuber_name ? `· ${escapeHtml(p.vtuber_name)}` : "";
      const liked = p.my_liked ? "좋아요 취소" : "좋아요";
      const likeBtnClass = p.my_liked ? "btn danger small" : "btn small";
      const canDelete = state.user && p.user_id === state.user.id;

      const commentsHtml = (p.comments || [])
        .map((c) => `
          <div class="comment">
            <div class="commentMeta">${escapeHtml(c.profiles?.nickname || "익명")} · ${fmtTime(c.created_at)}</div>
            <div>${escapeHtml(c.body)}</div>
          </div>
        `)
        .join("");

      return `
        <div class="post" data-post="${escapeHtml(p.id)}">
          <div class="postTop">
            <div>
              <div class="postTitle">${escapeHtml(p.title)}</div>
              <div class="postBody">${escapeHtml(p.body)}</div>
              <div class="postMeta">
                <span>${escapeHtml(p.author_nickname)}${vt}</span>
                <span class="sep">•</span>
                <span>${fmtTime(p.created_at)}</span>
              </div>
            </div>
            <div>
              ${canDelete ? `<button class="btn small danger" data-del-post="${escapeHtml(p.id)}">삭제</button>` : ""}
            </div>
          </div>

          <div class="actions">
            <button class="${likeBtnClass}" data-like="${escapeHtml(p.id)}">${liked} (${p.like_count})</button>
            <span class="sep">•</span>
            <span class="badge">댓글 ${p.comments.length}</span>
          </div>

          <div class="commentBox">
            <input class="input" data-comment-input="${escapeHtml(p.id)}" placeholder="댓글을 입력하세요" />
            <button class="btn small primary" data-comment-add="${escapeHtml(p.id)}">댓글 등록</button>
          </div>

          <div class="commentList">
            ${commentsHtml || `<div class="hint">아직 댓글이 없어요.</div>`}
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-like]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      const postId = btn.getAttribute("data-like");
      await toggleLike(postId);
    });
  });

  document.querySelectorAll("[data-comment-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      const postId = btn.getAttribute("data-comment-add");
      const input = document.querySelector(`[data-comment-input="${CSS.escape(postId)}"]`);
      const body = (input?.value || "").trim();
      if (!body) return alert("댓글 내용을 입력하세요.");
      await addComment(postId, body);
      if (input) input.value = "";
    });
  });

  document.querySelectorAll("[data-del-post]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      const postId = btn.getAttribute("data-del-post");
      if (!confirm("정말 게시글을 삭제할까요?")) return;

      const { error } = await supabase.from("posts").delete().eq("id", postId);
      if (error) {
        console.warn(error);
        alert("삭제 실패: 권한 또는 정책(RLS)을 확인하세요.");
        return;
      }
      await loadPosts();
    });
  });
}

async function createPost() {
  if (!requireLogin()) return;

  const title = els.postTitle.value.trim();
  const body = els.postBody.value.trim();
  const vtuber_id = els.vtuberFilter.value || null;

  if (!title) return alert("제목을 입력하세요.");
  if (!body) return alert("내용을 입력하세요.");

  const { error } = await supabase.from("posts").insert({
    vtuber_id,
    title,
    body,
    user_id: state.user.id
  });

  if (error) {
    console.warn(error);
    alert("작성 실패: 권한 또는 정책(RLS)을 확인하세요.");
    return;
  }

  els.postTitle.value = "";
  els.postBody.value = "";
  await loadPosts();
}

async function toggleLike(postId) {
  const { data: existing, error: e1 } = await supabase
    .from("likes")
    .select("*")
    .eq("post_id", postId)
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (e1) console.warn(e1);

  if (existing) {
    const { error } = await supabase.from("likes").delete().eq("id", existing.id);
    if (error) {
      console.warn(error);
      alert("좋아요 취소 실패");
      return;
    }
  } else {
    const { error } = await supabase
      .from("likes")
      .insert({ post_id: postId, user_id: state.user.id });

    if (error) {
      console.warn(error);
      alert("좋아요 실패");
      return;
    }
  }
  await loadPosts();
}

async function addComment(postId, body) {
  const { error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: state.user.id, body });

  if (error) {
    console.warn(error);
    alert("댓글 등록 실패");
    return;
  }
  await loadPosts();
}

/** ✅ 구글 로그인 */
async function loginGoogle() {
  const redirectTo = window.location.origin;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // 구글은 스코프를 늘릴 수도 있는데(예: "email profile"),
      // 기본만으로도 충분합니다.
    }
  });
  if (error) {
    console.warn(error);
    alert("구글 로그인 시작 실패");
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.warn(error);
    alert("로그아웃 실패");
    return;
  }
  state.user = null;
  state.profile = null;
  renderAuth();
  await loadPosts();
}

function bindUI() {
  els.btnLogin.addEventListener("click", loginGoogle);
  els.btnLogout.addEventListener("click", logout);

  els.btnAddVtuber.addEventListener("click", addVtuber);
  els.btnCreatePost.addEventListener("click", createPost);

  els.vtuberFilter.addEventListener("change", loadPosts);
}

async function init() {
  bindUI();

  await refreshSession();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.user = session?.user || null;
    await ensureProfile();
    renderAuth();
    await loadPosts();
  });

  await loadVtubers();
  await loadPosts();
}

init();
