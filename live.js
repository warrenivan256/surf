/* Live Surf data adapter. Loaded after the single-file UI script. */
(() => {
  if (!window.surfLiveMode || !window.surfSupabase) return;

  const db = window.surfSupabase;
  let friends = [];
  let requests = [];
  let groups = [];
  let storySets = [];
  let activeProfile = null;
  let selfProfile = null;
  let activeFriendTab = 'all';
  let activeChannel = null;
  let messageChannel = null;
  let pendingProfileImage = null;
  let pendingCropData = null;

  const initials = (person) => (person?.display_name || person?.username || '?')
    .trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
  const statusLabel = (status) => ({ online: 'Online now', dnd: 'Do not disturb', offline: 'Offline' }[status] || 'Offline');
  const safeError = (error, fallback) => { console.error(error); toast(error?.message || fallback); };
  const escapeText = (value) => String(value || '');

  function removeSeedContent() {
    const list = document.getElementById('chatList');
    if (list) list.innerHTML = '<p class="friends-empty live-empty">No conversations yet. Find people to connect.</p>';
    const messages = document.getElementById('messages');
    if (messages) messages.innerHTML = '<p class="friends-empty live-empty">Your messages will appear here when you connect with friends.</p>';
    const chatName = document.getElementById('chatName');
    if (chatName) chatName.textContent = 'Choose a conversation';
    const avatar = document.getElementById('chatAvatar');
    if (avatar) { avatar.textContent = ''; avatar.style.display = 'none'; }
    const status = document.getElementById('chatStatus');
    if (status) status.textContent = '';
    const composer = document.getElementById('composer');
    if (composer) composer.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
    const storyStrip = document.querySelector('.stories');
    if (storyStrip) [...storyStrip.children].forEach((item) => { if (item.id !== 'yourStoryCard') item.remove(); });
    document.querySelectorAll('.music-now').forEach((item) => item.remove());
    const sharedHeading = [...document.querySelectorAll('.right-title')].find((item) => item.textContent.trim() === 'Shared photos');
    if (sharedHeading) sharedHeading.parentElement.remove();
    document.querySelectorAll('.shared').forEach((item) => item.remove());
    document.querySelectorAll('.stats b').forEach((item) => { item.textContent = '0'; });
    document.querySelectorAll('#profileCardPosts,#profileCardFollowers,#profileCardFollowing').forEach((item) => { item.textContent = '0'; });
    document.getElementById('groupSidebar')?.setAttribute('style', 'display:none');
    document.querySelector('.age-badge')?.setAttribute('style', 'display:none');
    setEmpty(document.getElementById('profileGrid'), 'Your posts will appear here when you share them.');
    setEmpty(document.querySelector('.discover-posts'), 'No posts yet.');
    document.querySelectorAll('.profile-stats b').forEach((item) => { item.textContent = '0'; });
    document.querySelectorAll('#discoverPosts,#discoverFollowers,#discoverFollowing').forEach((item) => { item.textContent = '0'; });
  }

  function setEmpty(container, message) {
    if (!container) return;
    container.innerHTML = '';
    const text = document.createElement('p');
    text.className = 'friends-empty live-empty';
    text.textContent = message;
    container.append(text);
  }

  function avatarNode(person, className = 'avatar') {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = initials(person);
    return node;
  }

  function findPerson(id) { return friends.find((person) => person.id === id) || storySets.find((entry) => entry.owner.id === id)?.owner || (activeProfile?.id === id ? activeProfile : null); }

  function profileAssetUrl(path) {
    if (!path) return '';
    return db.storage.from('surf-profile-assets').getPublicUrl(path).data.publicUrl;
  }

  function applyProfileAssets(profile) {
    const avatarUrl = profileAssetUrl(profile?.avatar_path);
    const bannerUrl = profileAssetUrl(profile?.banner_path);
    const cropFor = (kind) => {
      try { return JSON.parse(localStorage.getItem(`surf-profile-crop:${profile?.id}:${kind}`) || 'null'); } catch { return null; }
    };
    const paint = (element, url, crop) => {
      if (!element || !url) return;
      element.style.backgroundImage = `url("${url}")`; element.style.backgroundRepeat = 'no-repeat';
      if (crop?.width && crop?.height && crop?.sourceWidth && crop?.sourceHeight) {
        const rect = element.getBoundingClientRect();
        const scale = Math.max(rect.width / crop.width, rect.height / crop.height);
        element.style.backgroundSize = `${Math.round(crop.sourceWidth * scale)}px ${Math.round(crop.sourceHeight * scale)}px`;
        element.style.backgroundPosition = `-${Math.round(crop.x * scale)}px -${Math.round(crop.y * scale)}px`;
      } else { element.style.backgroundSize = 'cover'; element.style.backgroundPosition = 'center'; }
    };
    if (avatarUrl) {
      const avatar = document.querySelector('.profile-avatar');
      if (avatar) {
        [...avatar.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => node.remove());
        paint(avatar, avatarUrl, cropFor('avatar'));
      }
      const pageAvatar = document.getElementById('pageAvatar');
      if (pageAvatar) { pageAvatar.textContent = ''; paint(pageAvatar, avatarUrl, cropFor('avatar')); }
    }
    if (bannerUrl) {
      const cover = document.querySelector('.profile-cover');
      paint(cover, bannerUrl, cropFor('banner'));
      document.documentElement.style.setProperty('--profile-banner', `url("${bannerUrl}")`);
      const crop = cropFor('banner');
      if (crop?.width && crop?.height && crop?.sourceWidth && crop?.sourceHeight) {
        const width = Math.min(980, Math.max(300, window.innerWidth - 32)), height = 170;
        const scale = Math.max(width / crop.width, height / crop.height);
        document.documentElement.style.setProperty('--banner-size', `${Math.round(crop.sourceWidth * scale)}px ${Math.round(crop.sourceHeight * scale)}px`);
        document.documentElement.style.setProperty('--banner-position', `-${Math.round(crop.x * scale)}px -${Math.round(crop.y * scale)}px`);
      } else {
        document.documentElement.style.setProperty('--banner-size', 'cover');
        document.documentElement.style.setProperty('--banner-position', 'center');
      }
    }
  }

  async function loadLiveSurfWorkspace() {
    const userId = window.surfCurrentUserId;
    if (!userId) return;
    try {
      const [{ data: relations, error: relationError }, { data: groupRows, error: groupError }] = await Promise.all([
        db.from('friend_requests').select('id,requester_id,addressee_id,status,created_at').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        db.from('group_conversations').select('id,name,owner_id,created_at').order('created_at', { ascending: false })
      ]);
      if (relationError) throw relationError;
      if (groupError) throw groupError;
      requests = relations || [];
      const ids = [...new Set(requests.flatMap((rel) => rel.status === 'accepted' ? [rel.requester_id, rel.addressee_id] : [rel.requester_id, rel.addressee_id]).filter((id) => id !== userId))];
      if (ids.length) {
        const { data: profiles, error } = await db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path').in('id', ids);
        if (error) throw error;
        const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
        friends = requests.map((rel) => ({ ...byId.get(rel.requester_id === userId ? rel.addressee_id : rel.requester_id), relation: rel }))
          .filter((person) => person.id);
      } else friends = [];
      groups = groupRows || [];
      await Promise.all([renderChatList(), renderFriendsList(), loadStories(), updateOwnCounts()]);
      renderDiscoverResults();
      syncGroupPicker();
      bindSearches();
      subscribeMessages();
    } catch (error) {
      safeError(error, 'Could not load your Surf account data. Check that the database setup completed.');
    }
  }

  async function latestMessages() {
    const id = window.surfCurrentUserId;
    const { data, error } = await db.from('direct_messages').select('id,sender_id,recipient_id,body,created_at')
      .or(`sender_id.eq.${id},recipient_id.eq.${id}`).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  }

  async function renderChatList() {
    const list = document.getElementById('chatList');
    if (!list) return;
    list.innerHTML = '';
    let messages = [];
    try { messages = await latestMessages(); } catch (error) { safeError(error, 'Could not load conversations.'); }
    const friendIds = new Set(requests.filter((item) => item.status === 'accepted').map((item) => item.requester_id === window.surfCurrentUserId ? item.addressee_id : item.requester_id));
    const people = friends.filter((person) => friendIds.has(person.id));
    people.forEach((person) => {
      const row = document.createElement('div');
      row.className = 'person';
      row.dataset.userId = person.id;
      const latest = messages.find((message) => message.sender_id === person.id || message.recipient_id === person.id);
      const copy = document.createElement('div');
      copy.className = 'person-info';
      const name = document.createElement('div'); name.className = 'person-name'; name.textContent = person.display_name || person.username;
      const preview = document.createElement('div'); preview.className = 'preview'; preview.textContent = latest?.body || 'Start a conversation';
      const time = document.createElement('div'); time.className = 'time'; time.textContent = statusLabel(person.status);
      copy.append(name, preview);
      row.append(avatarNode(person), copy, time);
      row.onclick = () => selectLivePerson(row, person);
      list.append(row);
    });
    groups.forEach((group) => {
      const row = document.createElement('div'); row.className = 'person'; row.dataset.groupId = group.id;
      const icon = document.createElement('span'); icon.className = 'avatar'; icon.textContent = 'G';
      const copy = document.createElement('div'); copy.className = 'person-info';
      const name = document.createElement('div'); name.className = 'person-name'; name.textContent = group.name;
      const preview = document.createElement('div'); preview.className = 'preview'; preview.textContent = 'Group conversation';
      copy.append(name, preview); row.append(icon, copy); row.onclick = () => selectLiveGroup(row, group); list.append(row);
    });
    if (!people.length && !groups.length) setEmpty(list, 'No conversations yet. Use Discover to find people and send a friend request.');
  }

  function clearMessages(message) { setEmpty(document.getElementById('messages'), message); }

  function displayMessage(message, person) {
    const list = document.getElementById('messages');
    if (!list) return;
    list.querySelector('.live-empty')?.remove();
    const row = document.createElement('div');
    const mine = message.sender_id === window.surfCurrentUserId;
    row.className = `msgrow${mine ? ' me' : ''}`;
    if (!mine) row.append(avatarNode(person, 'mini-avatar'));
    const wrap = document.createElement('div');
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = message.body;
    const stamp = document.createElement('div'); stamp.className = 'stamp'; stamp.textContent = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrap.append(bubble, stamp); row.append(wrap); list.append(row); list.scrollTop = list.scrollHeight;
  }

  async function loadDirectMessages(person) {
    clearMessages(`Your conversation with ${person.display_name || person.username} will appear here.`);
    const current = window.surfCurrentUserId;
    const filter = `and(sender_id.eq.${current},recipient_id.eq.${person.id}),and(sender_id.eq.${person.id},recipient_id.eq.${current})`;
    const { data, error } = await db.from('direct_messages').select('id,sender_id,recipient_id,body,created_at').or(filter).order('created_at');
    if (error) return safeError(error, 'Could not load this conversation.');
    const list = document.getElementById('messages'); list.innerHTML = '';
    if (!data?.length) return clearMessages('No messages yet. Say hello!');
    data.forEach((message) => displayMessage(message, person));
  }

  async function selectLivePerson(row, person) {
    document.querySelectorAll('#chatList .person').forEach((item) => item.classList.remove('selected'));
    row.classList.add('selected');
    window.surfActiveRecipientId = person.id; window.surfActiveGroupId = null;
    document.getElementById('chatName').textContent = person.display_name || person.username;
    const avatar = document.getElementById('chatAvatar'); avatar.textContent = initials(person); avatar.style.display = 'grid';
    document.getElementById('chatStatus').textContent = '● ' + statusLabel(person.status);
    document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = false; });
    document.getElementById('blockedNotice').style.display = 'none';
    app.classList.add('show-chat');
    await loadDirectMessages(person);
  }

  async function selectLiveGroup(row, group) {
    document.querySelectorAll('#chatList .person').forEach((item) => item.classList.remove('selected'));
    row.classList.add('selected'); window.surfActiveRecipientId = null; window.surfActiveGroupId = group.id;
    document.getElementById('chatName').textContent = group.name;
    document.getElementById('chatAvatar').textContent = 'G'; document.getElementById('chatAvatar').style.display = 'grid';
    document.getElementById('chatStatus').textContent = 'Group conversation';
    document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = false; });
    app.classList.add('show-chat'); clearMessages('Group messages will appear here.');
    const { data, error } = await db.from('group_messages').select('id,sender_id,body,created_at').eq('group_id', group.id).order('created_at');
    if (error) return safeError(error, 'Could not load this group.');
    const list = document.getElementById('messages'); list.innerHTML = '';
    if (!data?.length) return clearMessages('No messages yet. Say hello!');
    data.forEach((message) => displayMessage(message, message.sender_id === window.surfCurrentUserId ? null : { username: 'Member' }));
  }

  async function sendLiveMessage(text) {
    const sender = window.surfCurrentUserId;
    if (!sender) return false;
    let result;
    if (window.surfActiveGroupId) {
      result = await db.from('group_messages').insert({ group_id: window.surfActiveGroupId, sender_id: sender, body: text }).select().single();
    } else if (window.surfActiveRecipientId) {
      result = await db.from('direct_messages').insert({ sender_id: sender, recipient_id: window.surfActiveRecipientId, body: text }).select().single();
    } else { toast('Choose a conversation first.'); return false; }
    if (result.error) { safeError(result.error, 'Message could not be sent.'); return false; }
    displayMessage(result.data, findPerson(result.data.recipient_id === sender ? result.data.sender_id : result.data.recipient_id));
    renderChatList();
    return true;
  }

  function subscribeMessages() {
    if (messageChannel) db.removeChannel(messageChannel);
    messageChannel = db.channel('surf-live-messages-' + window.surfCurrentUserId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${window.surfCurrentUserId}` }, (payload) => {
        if (payload.new.sender_id === window.surfActiveRecipientId) displayMessage(payload.new, findPerson(payload.new.sender_id));
        renderChatList();
      }).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, (payload) => {
        if (payload.new.group_id === window.surfActiveGroupId && payload.new.sender_id !== window.surfCurrentUserId) displayMessage(payload.new, { username: 'Member' });
      }).subscribe();
  }

  async function loadFriendsAndRequests() {
    const list = document.getElementById('friendsContent');
    if (!list) return;
    const query = (document.getElementById('friendsSearch')?.value || '').trim().toLowerCase();
    const selected = friends.filter((person) => {
      const rel = person.relation;
      const own = rel.requester_id === window.surfCurrentUserId;
      if (activeFriendTab === 'pending') return rel.status === 'pending';
      if (rel.status !== 'accepted') return false;
      if (activeFriendTab === 'online') return person.status === 'online';
      return !query || `${person.username} ${person.display_name}`.toLowerCase().includes(query);
    });
    document.getElementById('pendingCount').textContent = String(friends.filter((item) => item.relation.status === 'pending' && item.relation.addressee_id === window.surfCurrentUserId).length);
    list.innerHTML = '';
    const sections = activeFriendTab === 'pending' ? [['Pending requests', 'pending']] : activeFriendTab === 'online' ? [['Online', 'online']] : [['Online', 'online'], ['Do not disturb', 'dnd'], ['Offline', 'offline']];
    sections.forEach(([label, status]) => {
      const items = selected.filter((person) => activeFriendTab === 'pending' ? person.relation.status === 'pending' : person.status === status);
      if (!items.length) return;
      const section = document.createElement('section'); section.className = 'friend-section';
      const heading = document.createElement('h2'); heading.textContent = `${label} · ${items.length}`; section.append(heading);
      items.forEach((person) => {
        const row = document.createElement('div'); row.className = 'friend-row';
        const identity = document.createElement('div'); identity.className = 'friend-identity'; identity.append(avatarNode(person, 'friend-avatar'));
        const copy = document.createElement('div'); copy.className = 'friend-copy';
        const name = document.createElement('b'); name.textContent = person.display_name || person.username;
        const sub = document.createElement('small'); sub.textContent = person.relation.status === 'pending' ? (person.relation.requester_id === window.surfCurrentUserId ? 'Request sent' : 'Sent you a request') : statusLabel(person.status);
        copy.append(name, sub); identity.append(copy); row.append(identity);
        if (person.relation.status === 'pending' && person.relation.addressee_id === window.surfCurrentUserId) {
          const accept = document.createElement('button'); accept.className = 'friend-request-action accept'; accept.title = 'Accept request'; accept.textContent = '✓'; accept.onclick = () => answerRequest(person.relation, true);
          const reject = document.createElement('button'); reject.className = 'friend-request-action reject'; reject.title = 'Decline request'; reject.textContent = '×'; reject.onclick = () => answerRequest(person.relation, false); row.append(accept, reject);
        } else if (person.relation.status === 'accepted') {
          const chat = document.createElement('button'); chat.className = 'friend-request-action accept'; chat.title = 'Message'; chat.textContent = '…'; chat.onclick = () => { closeModal('friendsModal'); const chatRow = document.querySelector(`#chatList [data-user-id="${person.id}"]`); if (chatRow) selectLivePerson(chatRow, person); }; row.append(chat);
        }
        section.append(row);
      });
      list.append(section);
    });
    if (!list.children.length) setEmpty(list, activeFriendTab === 'pending' ? 'No pending friend requests.' : 'No friends to show yet. Use Discover to find people.');
  }

  async function answerRequest(relation, accepted) {
    const { error } = await db.from('friend_requests').update({ status: accepted ? 'accepted' : 'declined', updated_at: new Date().toISOString() }).eq('id', relation.id);
    if (error) return safeError(error, 'Could not update the friend request.');
    await loadLiveSurfWorkspace(); toast(accepted ? 'Friend request accepted.' : 'Friend request declined.');
  }

  function setFriendTab(tab, button) {
    activeFriendTab = tab;
    document.querySelectorAll('[data-friend-tab]').forEach((item) => item.classList.toggle('active', item === button));
    loadFriendsAndRequests();
    requestAnimationFrame(() => { const nav = document.querySelector('.friends-tabs'), active = nav?.querySelector('[data-friend-tab].active'), indicator = document.getElementById('friendsTabIndicator'); if (nav && active && indicator) { indicator.style.left = `${active.offsetLeft}px`; indicator.style.width = `${active.offsetWidth}px`; } });
  }

  async function renderDiscoverResults() {
    const box = document.getElementById('discoverResults');
    if (!box) return;
    const raw = (document.getElementById('discoverInput')?.value || '').trim();
    if (raw.length < 2) return setEmpty(box, 'Type at least two characters to search real Surf users.');
    const term = raw.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
    if (!term) return setEmpty(box, 'Enter a name or username to search.');
    const [byUsername, byName] = await Promise.all([
      db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path').neq('id', window.surfCurrentUserId).ilike('username', `%${term}%`).limit(20),
      db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path').neq('id', window.surfCurrentUserId).ilike('display_name', `%${term}%`).limit(20)
    ]);
    if (byUsername.error) return safeError(byUsername.error, 'Search is unavailable right now.');
    if (byName.error) return safeError(byName.error, 'Search is unavailable right now.');
    const data = [...new Map([...(byUsername.data || []), ...(byName.data || [])].map((person) => [person.id, person])).values()].slice(0, 20);
    box.innerHTML = '';
    (data || []).forEach((person) => {
      const row = document.createElement('div'); row.className = 'discover-result';
      const avatar = avatarNode(person, 'discover-result-avatar');
      const avatarUrl = profileAssetUrl(person.avatar_path);
      if (avatarUrl) { avatar.textContent = ''; avatar.style.backgroundImage = `url("${avatarUrl}")`; avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; }
      const copy = document.createElement('span'); copy.className = 'discover-result-copy';
      const name = document.createElement('b'); name.textContent = person.display_name || person.username;
      const handle = document.createElement('small'); handle.textContent = '@' + person.username; copy.append(name, handle);
      const view = document.createElement('button'); view.className = 'btn primary'; view.type = 'button'; view.textContent = 'View profile'; view.onclick = () => openLiveProfile(person);
      row.append(avatar, copy, view); row.onclick = (event) => { if (event.target !== view) openLiveProfile(person); }; box.append(row);
    });
    if (!data?.length) setEmpty(box, 'No Surf users found with that name yet.');
  }

  async function requestStatus(personId) {
    const row = requests.find((item) => (item.requester_id === personId && item.addressee_id === window.surfCurrentUserId) || (item.addressee_id === personId && item.requester_id === window.surfCurrentUserId));
    if (!row) return 'none';
    return row.status === 'pending' ? (row.requester_id === window.surfCurrentUserId ? 'sent' : 'received') : row.status;
  }

  async function openLiveProfile(person) {
    activeProfile = person;
    document.getElementById('discoverAvatar').textContent = initials(person);
    const avatarUrl = profileAssetUrl(person.avatar_path);
    const discoverAvatar = document.getElementById('discoverAvatar');
    discoverAvatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
    discoverAvatar.style.backgroundSize = 'cover'; discoverAvatar.style.backgroundPosition = 'center';
    const discoverBanner = document.getElementById('discoverBanner');
    discoverBanner.style.backgroundImage = person.banner_path ? `url("${profileAssetUrl(person.banner_path)}")` : '';
    discoverBanner.style.backgroundSize = 'cover'; discoverBanner.style.backgroundPosition = 'center';
    document.getElementById('discoverName').textContent = person.display_name || person.username;
    document.getElementById('discoverHandle').textContent = '@' + person.username + ' · ' + statusLabel(person.status).toLowerCase();
    document.getElementById('discoverBio').textContent = person.bio || 'No bio yet.';
    document.getElementById('discoverPosts').textContent = '0';
    document.getElementById('discoverFollowers').textContent = '0';
    document.getElementById('discoverFollowing').textContent = '0';
    const state = await requestStatus(person.id);
    document.getElementById('discoverFollowButton').textContent = ({ sent: 'Requested', received: 'Accept request', accepted: 'Unfriend' }[state] || 'Add friend');
    document.getElementById('discoverBlockLabel').textContent = 'Block';
    document.getElementById('discoverMoreMenu').style.display = 'none';
    openModal('discoverProfileModal');
  }

  async function toggleLiveFriendRequest() {
    if (!activeProfile) return;
    const state = await requestStatus(activeProfile.id);
    let result;
    const match = requests.find((item) => (item.requester_id === activeProfile.id && item.addressee_id === window.surfCurrentUserId) || (item.addressee_id === activeProfile.id && item.requester_id === window.surfCurrentUserId));
    if (state === 'none' || state === 'declined' || state === 'cancelled') {
      result = await db.from('friend_requests').insert({ requester_id: window.surfCurrentUserId, addressee_id: activeProfile.id });
    } else if (state === 'sent') {
      result = await db.from('friend_requests').delete().eq('id', match.id);
    } else if (state === 'received') {
      result = await db.from('friend_requests').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', match.id);
    } else if (state === 'accepted') {
      if (!confirm(`Are you sure you want to unfriend ${activeProfile.display_name || activeProfile.username}?`)) return;
      result = match.requester_id === window.surfCurrentUserId
        ? await db.from('friend_requests').delete().eq('id', match.id)
        : await db.from('friend_requests').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', match.id);
    }
    if (result?.error) return safeError(result.error, 'Could not update this connection.');
    await loadLiveSurfWorkspace();
    openLiveProfile(activeProfile);
  }

  async function toggleLiveBlock() {
    const target = activeProfile?.id || window.surfActiveRecipientId;
    if (!target) return toast('Choose a profile first.');
    const { data, error } = await db.from('blocks').select('blocker_id').eq('blocker_id', window.surfCurrentUserId).eq('blocked_id', target).maybeSingle();
    if (error) return safeError(error, 'Could not check this block.');
    const result = data ? await db.from('blocks').delete().eq('blocker_id', window.surfCurrentUserId).eq('blocked_id', target) : await db.from('blocks').insert({ blocker_id: window.surfCurrentUserId, blocked_id: target });
    if (result.error) return safeError(result.error, 'Could not update block settings.');
    if (activeProfile) document.getElementById('discoverMoreMenu').style.display = 'none';
    toast(data ? 'User unblocked.' : 'User blocked.');
    await loadLiveSurfWorkspace();
  }

  async function toggleLiveMute() {
    const target = window.surfActiveRecipientId || activeProfile?.id;
    if (!target) return toast('Choose a profile first.');
    const { data, error } = await db.from('mutes').select('muted_id').eq('muter_id', window.surfCurrentUserId).eq('muted_id', target).maybeSingle();
    if (error) return safeError(error, 'Could not check mute settings.');
    const result = data ? await db.from('mutes').delete().eq('muter_id', window.surfCurrentUserId).eq('muted_id', target) : await db.from('mutes').insert({ muter_id: window.surfCurrentUserId, muted_id: target });
    if (result.error) return safeError(result.error, 'Could not update mute settings.');
    document.getElementById('profileCardMoreMenu')?.style && (document.getElementById('profileCardMoreMenu').style.display = 'none');
    toast(data ? 'User unmuted.' : 'User muted.');
  }

  function renderStoriesStrip() {
    const strip = document.querySelector('.stories');
    if (!strip) return;
    [...strip.children].forEach((item) => { if (item.id !== 'yourStoryCard') item.remove(); });
    storySets.forEach((entry) => {
      const item = document.createElement('div'); item.className = 'story'; item.tabIndex = 0;
      const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(entry.owner); wrap.append(avatar);
      const name = document.createElement('span'); name.textContent = entry.owner.display_name || entry.owner.username;
      item.append(wrap, name); item.onclick = () => openLiveStory(entry); strip.append(item);
    });
  }

  async function loadStories() {
    const { data, error } = await db.from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
    if (error) throw error;
    const stories = data || [];
    const ownerIds = [...new Set(stories.map((story) => story.owner_id))];
    let profileMap = new Map();
    if (ownerIds.length) {
      const { data: profiles, error: profileError } = await db.from('profiles').select('id,username,display_name,status').in('id', ownerIds);
      if (profileError) throw profileError;
      profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }
    for (const story of stories) {
      if (story.media_path) {
        const { data: signed, error: signedError } = await db.storage.from('surf-stories').createSignedUrl(story.media_path, 3600);
        if (signedError) { console.warn(signedError); continue; }
        story.url = signed.signedUrl;
      }
      story.type = story.kind;
      story.text = story.body;
      story.color = story.background_color;
    }
    const own = stories.filter((item) => item.owner_id === window.surfCurrentUserId);
    yourStories = own;
    const avatar = document.getElementById('yourStoryAvatar');
    if (avatar) {
      const first = own[0];
      avatar.className = 'avatar' + (first?.kind === 'text' ? ' text-story-avatar' : '');
      avatar.style.backgroundImage = first?.kind === 'image' ? `url("${first.url}")` : '';
      avatar.style.backgroundColor = first?.kind === 'text' ? first.background_color : '';
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
      avatar.textContent = first?.kind === 'text' ? first.body : first?.kind === 'image' ? '' : '＋';
      document.getElementById('yourStoryLabel').textContent = own.length ? 'Your story · view' : 'Your story';
    }
    const grouped = new Map();
    stories.filter((item) => item.owner_id !== window.surfCurrentUserId).forEach((story) => {
      const owner = profileMap.get(story.owner_id); if (!owner) return;
      if (!grouped.has(owner.id)) grouped.set(owner.id, { owner, items: [], time: 'recently' });
      grouped.get(owner.id).items.push(story);
    });
    storySets = [...grouped.values()];
    renderStoriesStrip();
  }

  function openLiveStory(entry) {
    activeStoryCollection = entry.items; activeStoryOwner = entry.isYours ? 'Your story' : entry.owner.display_name || entry.owner.username;
    activeStoryEmoji = initials(entry.owner || {}); activeStoryIndex = 0;
    renderStoryViewer(); openModal('storyViewer');
  }

  function renderLiveStoryViewer() {
    const story = activeStoryCollection?.[activeStoryIndex]; if (!story) return;
    const image = document.getElementById('storyViewerImage'), text = document.getElementById('storyViewerText');
    image.style.display = story.kind === 'image' ? 'block' : 'none'; text.style.display = story.kind === 'text' ? 'grid' : 'none';
    if (story.kind === 'image') { image.src = story.url; text.textContent = ''; }
    else { text.textContent = story.body; text.style.background = story.background_color; }
    document.getElementById('storyViewerName').textContent = activeStoryOwner;
    document.getElementById('storyViewerAvatar').textContent = activeStoryEmoji;
    document.getElementById('storyViewerCount').textContent = `${activeStoryIndex + 1} / ${activeStoryCollection.length}`;
    document.getElementById('storyViewerMeta').textContent = story.expires_at ? `Expires ${new Date(story.expires_at).toLocaleString()}` : 'Just now · expires in 24 hours';
    document.querySelector('.story-prev').style.display = activeStoryIndex > 0 ? 'grid' : 'none';
    document.querySelector('.story-next').style.display = activeStoryIndex < activeStoryCollection.length - 1 ? 'grid' : 'none';
    document.querySelector('.story-viewer-add').style.display = activeStoryOwner === 'Your story' ? 'block' : 'none';
  }

  async function shareLiveStory() {
    if (!window.surfCurrentUserId) return toast('Sign in before sharing a story.');
    const pending = storyDraftMode === 'photo' ? storyDraftFiles : [];
    const body = storyDraftMode === 'text' ? document.getElementById('storyTextInput').value.trim() : '';
    if (storyDraftMode === 'photo' && !pending.length) return toast('Choose at least one photo.');
    if (storyDraftMode === 'text' && !body) return toast('Write something for your story first.');
    playSettingsSwish(true, 1);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const uploaded = [];
    try {
      if (storyDraftMode === 'text') {
        const { data, error } = await db.from('stories').insert({ owner_id: window.surfCurrentUserId, kind: 'text', body, background_color: storyDraftColor }).select().single();
        if (error) throw error; data.type = 'text'; data.text = data.body; data.color = data.background_color; uploaded.push(data);
      } else {
        for (const file of pending) {
          const storyId = crypto.randomUUID();
          const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || 'story-image';
          const path = `${window.surfCurrentUserId}/${storyId}/${name}`;
          const { error: uploadError } = await db.storage.from('surf-stories').upload(path, file, { contentType: file.type, upsert: false });
          if (uploadError) throw uploadError;
          const { data, error } = await db.from('stories').insert({ id: storyId, owner_id: window.surfCurrentUserId, kind: 'image', media_path: path }).select().single();
          if (error) { await db.storage.from('surf-stories').remove([path]); throw error; }
          const { data: signed } = await db.storage.from('surf-stories').createSignedUrl(path, 3600);
          data.url = signed?.signedUrl; data.type = 'image'; uploaded.push(data);
        }
      }
      yourStories = [...uploaded, ...(yourStories || [])];
      await loadStories(); closeModal('storyModal'); activeStoryCollection = yourStories; activeStoryOwner = 'Your story'; activeStoryEmoji = initials({ username: document.querySelector('.profile-name')?.textContent }); activeStoryIndex = 0;
      renderStoryViewer(); openModal('storyViewer'); toast('Uploaded!', 1000);
    } catch (error) { safeError(error, 'Story upload failed. Check storage setup and try again.'); }
  }

  function renderAllLiveStories() {
    const grid = document.getElementById('allStoriesGrid'); if (!grid) return;
    grid.innerHTML = '';
    const entries = [{ owner: { username: document.querySelector('.profile-handle')?.textContent.replace(/^@/, '') || 'you', display_name: 'Your story' }, items: yourStories, isYours: true }, ...storySets];
    entries.forEach((entry) => {
      if (!entry.items.length && !entry.isYours) return;
      const card = document.createElement('button'); card.type = 'button'; card.className = 'stories-page-card' + (entry.isYours ? ' is-yours' : '');
      const art = document.createElement('span'); art.className = 'stories-page-art';
      const first = entry.items[0];
      if (first?.kind === 'image') { art.style.backgroundImage = `url("${first.url}")`; art.style.backgroundSize = 'cover'; }
      else { art.style.backgroundColor = first?.background_color || '#282638'; art.textContent = first?.body || 'No story yet'; }
      const owner = document.createElement('span'); owner.className = 'stories-page-owner'; owner.append(avatarNode(entry.owner, 'stories-page-avatar'));
      const copy = document.createElement('span'), name = document.createElement('b'), time = document.createElement('small');
      name.textContent = entry.isYours ? 'Your story' : entry.owner.display_name || entry.owner.username;
      time.textContent = entry.isYours ? (entry.items.length ? `${entry.items.length} active` : 'Share a moment') : `${entry.items.length} active`;
      copy.append(name, time); owner.append(copy); card.append(art, owner);
      card.onclick = () => { closeModal('storiesPage'); if (!entry.items.length) { closeModal('storyViewer'); resetStoryComposer(); openModal('storyModal'); } else openLiveStory(entry); };
      grid.append(card);
    });
  }

  async function openProfileForCurrentChat() {
    const id = window.surfActiveRecipientId; const person = friends.find((item) => item.id === id);
    if (!person) return;
    activeProfile = person;
    document.getElementById('profileCardName').textContent = person.display_name || person.username;
    document.getElementById('profileCardHandle').textContent = '@' + person.username + ' · ' + statusLabel(person.status).toLowerCase();
    document.getElementById('profileCardBio').textContent = person.bio || 'No bio yet.';
    document.getElementById('profileCardAvatar').textContent = initials(person);
    const cardAvatarUrl = profileAssetUrl(person.avatar_path);
    const cardAvatar = document.getElementById('profileCardAvatar');
    cardAvatar.style.backgroundImage = cardAvatarUrl ? `url("${cardAvatarUrl}")` : '';
    cardAvatar.style.backgroundSize = 'cover'; cardAvatar.style.backgroundPosition = 'center';
    const cardBanner = document.getElementById('profileCardBanner');
    cardBanner.style.backgroundImage = person.banner_path ? `url("${profileAssetUrl(person.banner_path)}")` : '';
    cardBanner.style.backgroundSize = 'cover'; cardBanner.style.backgroundPosition = 'center';
    document.getElementById('profileCardPosts').textContent = '0'; document.getElementById('profileCardFollowers').textContent = '0'; document.getElementById('profileCardFollowing').textContent = '0';
    const rel = person.relation;
    document.getElementById('blockPersonButton').textContent = 'Block'; document.getElementById('mutePersonButton').textContent = 'Mute';
    document.getElementById('relationshipPersonButton').textContent = rel.requester_id === window.surfCurrentUserId ? 'Unfriend' : 'Unfriend';
    openModal('profileModal');
  }

  async function updateOwnCounts() {
    const id = window.surfCurrentUserId;
    const accepted = friends.filter((person) => person.relation.status === 'accepted').length;
    const { count } = await db.from('stories').select('id', { count: 'exact', head: true }).eq('owner_id', id).gt('expires_at', new Date().toISOString());
    const values = document.querySelectorAll('.stats b');
    if (values[0]) values[0].textContent = String(count || 0);
    if (values[1]) values[1].textContent = String(accepted);
    if (values[2]) values[2].textContent = String(accepted);
  }

  async function saveLiveProfile() {
    const displayName = document.getElementById('editUsername').value.trim();
    const username = document.getElementById('editHandle').value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 24);
    const bio = document.getElementById('editBio').value.trim().slice(0, 300);
    if (username.length < 3) return toast('Username needs at least 3 characters.');
    const { error } = await db.from('profiles').update({ display_name: displayName || username, username, bio, updated_at: new Date().toISOString() }).eq('id', window.surfCurrentUserId);
    if (error) return safeError(error, 'Could not save your profile.');
    document.querySelectorAll('.profile-name').forEach((el) => { el.textContent = displayName || username; });
    document.querySelectorAll('.profile-handle').forEach((el) => { el.textContent = '@' + username; });
    document.querySelectorAll('.bio').forEach((el) => { el.textContent = bio; });
    document.getElementById('myProfileMenuName').textContent = displayName || username;
    document.getElementById('myProfileMenuHandle').textContent = '@' + username;
    selfProfile = { ...selfProfile, username: displayName || username, handle: username, bio };
    document.getElementById('pageName').textContent = selfProfile.username;
    document.getElementById('pageHandle').textContent = username;
    document.getElementById('pageBio').textContent = bio;
    toast('Profile saved.');
  }

  function bindSearches() {
    document.getElementById('friendsSearch')?.addEventListener('input', loadFriendsAndRequests);
    document.getElementById('discoverInput')?.addEventListener('input', renderDiscoverResults);
  }

  async function createLiveGroup() {
    const input = document.getElementById('newGroupName'); const name = input.value.trim();
    if (!name) return toast('Add a group name first.');
    const selected = [...document.querySelectorAll('#groupFriendPicker input:checked')].map((item) => item.value);
    if (!selected.length) return toast('Choose at least one friend to add.');
    const { data: group, error } = await db.from('group_conversations').insert({ name, owner_id: window.surfCurrentUserId }).select().single();
    if (error) return safeError(error, 'Could not create the group.');
    const { error: memberError } = await db.from('group_members').insert(selected.map((user_id) => ({ group_id: group.id, user_id })));
    if (memberError) return safeError(memberError, 'The group was created, but friends could not be added.');
    input.value = ''; closeModal('createGroupModal'); await loadLiveSurfWorkspace();
    const row = document.querySelector(`#chatList [data-group-id="${group.id}"]`); if (row) selectLiveGroup(row, group);
    toast('Group created.');
  }

  function syncGroupPicker() {
    const list = document.getElementById('groupFriendPicker'); if (!list) return;
    list.innerHTML = '';
    const accepted = friends.filter((person) => person.relation.status === 'accepted');
    accepted.forEach((person) => {
      const label = document.createElement('label'); label.className = 'group-friend-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = person.id; input.onchange = () => { document.getElementById('groupFriendCount').textContent = `${list.querySelectorAll('input:checked').length} selected`; };
      const name = document.createElement('span'); name.textContent = `${person.display_name || person.username} · @${person.username}`;
      label.append(input, avatarNode(person, 'friend-list-avatar'), name); list.append(label);
    });
    if (!accepted.length) setEmpty(list, 'Add friends before creating a group.');
    document.getElementById('groupFriendCount').textContent = '0 selected';
  }

  async function openLiveCreateGroup() { syncGroupPicker(); openModal('createGroupModal'); }

  async function addLiveFriend() {
    const input = document.getElementById('addFriendInput');
    const username = input?.value.trim().replace(/^@/, '').toLowerCase();
    if (!username) return toast('Enter a username first.');
    const { data: person, error } = await db.from('profiles').select('id,username').eq('username', username).maybeSingle();
    if (error) return safeError(error, 'Could not search for that user.');
    if (!person) return toast('No account found with that username.');
    if (person.id === window.surfCurrentUserId) return toast('That is your own username.');
    const existing = await requestStatus(person.id);
    if (existing === 'accepted') return toast('You are already friends.');
    if (existing === 'sent') return toast('Friend request already sent.');
    if (existing === 'received') return toast('They already sent you a request. Open Pending to respond.');
    const { error: insertError } = await db.from('friend_requests').insert({ requester_id: window.surfCurrentUserId, addressee_id: person.id });
    if (insertError) return safeError(insertError, 'Could not send the friend request.');
    if (input) input.value = '';
    await loadLiveSurfWorkspace();
    toast('Friend request sent.');
  }

  async function persistProfileImage(file, kind) {
    if (!file || !window.surfCurrentUserId) return;
    if (!file.type.startsWith('image/')) return toast('Choose an image file.');
    if (file.size > 10 * 1024 * 1024) return toast('Images must be 10 MB or smaller.');
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${window.surfCurrentUserId}/${kind}-${Date.now()}.${extension}`;
    const { error: uploadError } = await db.storage.from('surf-profile-assets').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return safeError(uploadError, 'Image upload failed. Check profile image storage setup.');
    const column = kind === 'avatar' ? 'avatar_path' : 'banner_path';
    const previous = selfProfile?.[column];
    const { error: saveError } = await db.from('profiles').update({ [column]: path, updated_at: new Date().toISOString() }).eq('id', window.surfCurrentUserId);
    if (saveError) {
      await db.storage.from('surf-profile-assets').remove([path]);
      return safeError(saveError, 'Image uploaded but could not be saved to your profile.');
    }
    selfProfile = { ...selfProfile, [column]: path };
    const crop = pendingCropData;
    if (crop) localStorage.setItem(`surf-profile-crop:${window.surfCurrentUserId}:${kind}`, JSON.stringify(crop));
    applyProfileAssets(selfProfile);
    if (previous && previous !== path) await db.storage.from('surf-profile-assets').remove([previous]);
    toast(kind === 'avatar' ? 'Profile picture saved.' : 'Profile banner saved.');
  }

  function bindProfileImageUploads() {
    document.getElementById('pfpInput')?.addEventListener('change', (event) => { pendingProfileImage = event.target.files?.[0] ? { file: event.target.files[0], kind: 'avatar' } : null; });
    document.getElementById('bannerInput')?.addEventListener('change', (event) => { pendingProfileImage = event.target.files?.[0] ? { file: event.target.files[0], kind: 'banner' } : null; });
    const crop = window.saveCrop;
    window.saveCrop = async function() {
      const pending = pendingProfileImage; pendingProfileImage = null;
      let task = null;
      try { if (typeof cropTask !== 'undefined') task = cropTask; } catch { /* Crop state is not available. */ }
      crop();
      if (task?.source && task?.bounds) pendingCropData = { ...task.source, sourceWidth: task.naturalWidth, sourceHeight: task.naturalHeight };
      if (pending) {
        try { await persistProfileImage(pending.file, pending.kind); }
        finally { pendingCropData = null; }
      }
    };
    const cancel = window.cancelCrop;
    window.cancelCrop = function() { pendingProfileImage = null; cancel(); };
  }

  function enterAppWithLiveData() {
    const original = window.enterApp;
    window.enterApp = function(user) {
      original(user);
      if (user?.id) {
        selfProfile = user;
        window.surfCurrentUserId = user.id;
        removeSeedContent();
        applyProfileAssets(user);
        document.getElementById('pageName').textContent = user.username || 'Your profile';
        document.getElementById('pageHandle').textContent = user.handle || '';
        document.getElementById('pageBio').textContent = user.bio || '';
        loadLiveSurfWorkspace();
      }
      else { window.surfCurrentUserId = null; window.surfActiveRecipientId = null; window.surfActiveGroupId = null; }
    };
    window.showMyProfile = function() {
      if (!selfProfile) return;
      document.documentElement.style.removeProperty('--profile-banner');
      document.documentElement.style.removeProperty('--banner-size');
      document.documentElement.style.removeProperty('--banner-position');
      document.getElementById('pageName').textContent = selfProfile.username || 'Your profile';
      document.getElementById('pageHandle').textContent = selfProfile.handle || '';
      document.getElementById('pageBio').textContent = selfProfile.bio || '';
      setEmpty(document.getElementById('profileGrid'), 'Your posts will appear here when you share them.');
      document.querySelectorAll('#profileGrid .grid-post').forEach((item) => item.remove());
      document.querySelectorAll('#profilePage .profile-stats b').forEach((item) => { item.textContent = '0'; });
      document.getElementById('profilePage').style.display = 'block';
      applyProfileAssets(selfProfile);
    };
  }

  removeSeedContent();
  enterAppWithLiveData();
  window.selectPerson = (row) => { const person = friends.find((item) => item.id === row?.dataset.userId); if (person) return selectLivePerson(row, person); };
  window.appendMessage = sendLiveMessage;
  window.openProfile = openProfileForCurrentChat;
  window.openDiscoverProfile = openLiveProfile;
  window.renderDiscoverResults = renderDiscoverResults;
  window.toggleDiscoverFollow = toggleLiveFriendRequest;
  window.toggleCurrentRelationship = toggleLiveFriendRequest;
  window.toggleBlockCurrent = toggleLiveBlock;
  window.toggleMuteCurrent = toggleLiveMute;
  window.renderFriendsList = loadFriendsAndRequests;
  window.setFriendsTab = setFriendTab;
  window.renderStoryViewer = renderLiveStoryViewer;
  window.renderAllStories = renderAllLiveStories;
  window.openAllStories = () => { renderAllLiveStories(); openModal('storiesPage'); };
  window.openFriendStory = (name) => { const entry = storySets.find((item) => item.owner.display_name === name || item.owner.username === name); if (entry) openLiveStory(entry); };
  window.shareStoryDraft = shareLiveStory;
  window.saveProfileSettings = saveLiveProfile;
  window.syncGroupPicker = syncGroupPicker;
  window.openCreateGroupModal = openLiveCreateGroup;
  window.createGroup = createLiveGroup;
  window.openAddFriend = () => { openModal('discoverModal'); setTimeout(() => document.getElementById('discoverInput')?.focus(), 80); };
  window.addFriendDemo = addLiveFriend;
  window.messageDiscoverPerson = async () => {
    if (!activeProfile) return;
    const state = await requestStatus(activeProfile.id);
    closeModal('discoverProfileModal'); closeModal('discoverModal');
    if (state !== 'accepted') { activeProfile = { ...activeProfile }; return toast('Add this person as a friend before messaging.'); }
    const row = document.querySelector(`#chatList [data-user-id="${activeProfile.id}"]`);
    if (row) selectLivePerson(row, activeProfile);
  };
  window.showAboutThisProfile = () => {
    if (!activeProfile) return;
    document.getElementById('aboutCreated').textContent = activeProfile.created_at ? new Date(activeProfile.created_at).toLocaleDateString() : 'Recently';
    document.getElementById('aboutCountry').textContent = 'Not shared';
    document.getElementById('aboutUsernameChanges').textContent = 'Not shared';
    document.getElementById('discoverMoreMenu').style.display = 'none'; openModal('aboutProfileModal');
  };
  window.openCreateGroupModal = openLiveCreateGroup;

  // Replace demo copy in controls and keep the composer unavailable until a real chat is selected.
  document.querySelector('.blocked-banner span')?.replaceChildren(document.createTextNode('You blocked this person. They cannot message you.'));
  document.querySelector('.chats-head .section-label').textContent = 'Friends & chats';
  document.querySelector('.auth-note')?.replaceChildren(document.createTextNode('Your account is secured by Surf and Supabase.'));
  document.getElementById('profileCardPosts') && (document.getElementById('profileCardPosts').textContent = '0');
  document.querySelector('.stats')?.replaceChildren(...['Stories','Friends','Following'].map((label) => { const item=document.createElement('div'),value=document.createElement('b');value.textContent='0';item.append(value,document.createTextNode(label));return item; }));
  document.querySelector('.right-title')?.parentElement?.insertAdjacentHTML('afterend', '<p class="friends-empty">Your shared media will appear here.</p>');
  document.querySelector('.chat-top .top-actions')?.setAttribute('style', 'display:none');
  document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
  bindSearches();
  bindProfileImageUploads();
  if (window.surfCurrentUserId) loadLiveSurfWorkspace();
})();
