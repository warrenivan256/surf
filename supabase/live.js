/* Live Surf data adapter. Loaded after the single-file UI script. */
(() => {
  if (!window.surfLiveMode || !window.surfSupabase) return;

  const db = window.surfSupabase;
  let friends = [];
  let requests = [];
  let groups = [];
  let storySets = [];
  let highlightSets = [];
  let activeProfile = null;
  let pageFollowState = { personId: null, iFollow: false, followsMe: false, busy: false };
  let activeStoryProfile = null;
  let activeStoryViewId = null;
  let storyAdvanceTimer = null;
  let storyProgressSequence = 0;
  let postDraftFile = null;
  let archivedStories = [];
  const likedStoryIds = new Set();
  let selfProfile = null;
  let activeFriendTab = 'all';
  let activeChannel = null;
  let messageChannel = null;
  let pendingProfileImage = null;
  let pendingCropData = null;
  let notificationItems = [];
  let notificationRefreshTimer = null;
  let workspaceRefreshTimer = null;

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
    const url = profileAssetUrl(person?.avatar_path);
    node.textContent = url ? '' : initials(person);
    node.style.backgroundImage = url ? `url("${url}")` : '';
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center';
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


  function bindSurfSearches() {
    const messageSearch = document.querySelector('.search input, #messageSearch, input[placeholder*="Search messages"]');
    if (messageSearch) {
      messageSearch.placeholder = 'Search for friends or groups';
      messageSearch.disabled = false;
      messageSearch.addEventListener('input', () => {
        const term = messageSearch.value.trim().toLowerCase();
        document.querySelectorAll('#chatList .person').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
        });
        const discoverInput = document.getElementById('discoverInput');
        if (term.length >= 2 && discoverInput) { discoverInput.value = messageSearch.value; renderDiscoverResults(); }
      });
      messageSearch.addEventListener('keydown', event => {
        if (event.key === 'Enter' && messageSearch.value.trim().length >= 2) {
          const discover = document.getElementById('discoverModal');
          if (discover) { openModal('discoverModal'); const target = document.getElementById('discoverInput'); if (target) target.value = messageSearch.value; renderDiscoverResults(); }
        }
      });
    }
    const friendSearch = document.getElementById('friendsSearch');
    if (friendSearch && !friendSearch.dataset.liveBound) { friendSearch.dataset.liveBound = '1'; friendSearch.addEventListener('input', () => loadFriendsAndRequests()); }
  }

  async function setLivePresence(status) {
    if (!['online','dnd','offline'].includes(status)) return;
    const userId = window.surfCurrentUserId;
    if (!userId) return toast('Please sign in to change your status.');
    const { data: updatedProfile, error } = await db.from('profiles').update({ status, updated_at: new Date().toISOString() }).eq('id', userId).select('id,status,updated_at').maybeSingle();
    if (error) return safeError(error, 'Could not update your status. Check profile update permissions.');
    if (!updatedProfile) return toast('Status was not saved. Check your profile update policy.');
    selfProfile = { ...(selfProfile || {}), ...updatedProfile, status };
    document.querySelectorAll('[data-presence]').forEach(button => button.classList.toggle('selected', button.dataset.presence === status));
    const labels = { online: 'Online', dnd: 'Do not disturb', offline: 'Offline' };
    const label = document.getElementById('myPresenceText'); if (label) label.textContent = labels[status];
    localStorage.setItem('surfPresence', status);
    toast('Status set to ' + labels[status]);
  }

  async function loadLiveSurfWorkspace() {
    const userId = window.surfCurrentUserId;
    if (!userId) return;
    try {
      const [{ data: relations, error: relationError }, { data: membershipsForUser, error: memberGroupsError }] = await Promise.all([
        db.from('friend_requests').select('id,requester_id,addressee_id,status,created_at,updated_at').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        db.from('group_members').select('group_id,role').eq('user_id', userId)
      ]);
      if (relationError) throw relationError;
      if (memberGroupsError) throw memberGroupsError;
      const memberGroupIds = (membershipsForUser || []).map((m) => m.group_id);
      const { data: groupRows, error: groupError } = await db.from('group_conversations').select('id,name,bio,avatar_path,owner_id,created_at').order('created_at', { ascending: false });
      if (groupError) throw groupError;
      const visibleGroupIds = new Set([...(groupRows || []).filter(g => g.owner_id === userId).map(g => g.id), ...memberGroupIds]);
      const ownedGroups = (groupRows || []).filter((group) => group.owner_id === userId);
      if (ownedGroups.length) {
        const { error: ownerMembershipError } = await db.from('group_members').upsert(
          ownedGroups.map((group) => ({ group_id: group.id, user_id: userId, role: 'owner' })),
          { onConflict: 'group_id,user_id', ignoreDuplicates: true }
        );
        if (ownerMembershipError) throw ownerMembershipError;
      }
      requests = relations || [];
      const ids = [...new Set(requests.flatMap((rel) => [rel.requester_id, rel.addressee_id]).filter((id) => id !== userId))];
      if (ids.length) {
        const { data: profiles, error } = await db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path,is_minor,social_links,read_receipts_enabled').in('id', ids);
        if (error) throw error;
        const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
        const relationsByPerson = new Map();
        requests.forEach((rel) => {
          const personId = rel.requester_id === userId ? rel.addressee_id : rel.requester_id;
          if (!relationsByPerson.has(personId)) relationsByPerson.set(personId, []);
          relationsByPerson.get(personId).push(rel);
        });
        friends = [...relationsByPerson.entries()].map(([personId, matches]) => {
          const relation = preferredRelationship(matches, userId);
          return { ...byId.get(personId), relation };
        }).filter((person) => person.id);
      } else friends = [];
      groups = (groupRows || []).filter(group => visibleGroupIds.has(group.id));
      const { data: ownReceiptSetting, error: receiptSettingError } = await db.from('profiles').select('read_receipts_enabled').eq('id', userId).maybeSingle();
      if (receiptSettingError) throw receiptSettingError;
      if (ownReceiptSetting) {
        selfProfile = { ...selfProfile, ...ownReceiptSetting };
        localStorage.setItem('surfPref_readReceipts', String(ownReceiptSetting.read_receipts_enabled));
      }
      await Promise.all([renderChatList(), renderFriendsList(), loadStories(), updateOwnCounts()]);
      renderDiscoverResults();
      syncGroupPicker();
      bindSearches();
      bindSurfSearches();
      bindChatPhotoUpload();
      subscribeMessages();
      refreshNotifications(false);
    } catch (error) {
      safeError(error, 'Could not load your Surf account data. Check that the database setup completed.');
    }
  }

  async function latestMessages() {
    const id = window.surfCurrentUserId;
      const { data, error } = await db.from('direct_messages').select('id,sender_id,recipient_id,body,media_path,created_at,delivered_at,read_at')
      .or(`sender_id.eq.${id},recipient_id.eq.${id}`).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  }

  function chatReadKey(kind, id) {
    return `surfChatLastRead:${window.surfCurrentUserId}:${kind}:${id}`;
  }
  function getChatLastRead(kind, id) {
    const value = Number(localStorage.getItem(chatReadKey(kind, id)) || 0);
    return Number.isFinite(value) ? value : 0;
  }
  function markChatReadLocally(kind, id, timestamp = Date.now()) {
    if (!id || !window.surfCurrentUserId) return;
    localStorage.setItem(chatReadKey(kind, id), String(timestamp));
  }
  function addUnreadBadge(row, count) {
    if (!count) return;
    const badge = document.createElement('span');
    badge.className = 'chat-unread-badge';
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', `${count} unread message${count === 1 ? '' : 's'}`);
    row.append(badge);
  }

  async function renderChatList() {
    const list = document.getElementById('chatList');
    if (!list) return;
    list.innerHTML = '';
    let messages = [];
    try { messages = await latestMessages(); } catch (error) { safeError(error, 'Could not load conversations.'); }
    const unreadDirect = new Map();
    const unreadGroups = new Map();
    try {
      const { data: received, error: receivedError } = await db.from('direct_messages')
        .select('sender_id,created_at').eq('recipient_id', window.surfCurrentUserId)
        .order('created_at', { ascending: false }).limit(1000);
      if (receivedError) throw receivedError;
      for (const message of (received || [])) {
        const lastRead = getChatLastRead('direct', message.sender_id);
        if (Date.parse(message.created_at || 0) > lastRead) unreadDirect.set(message.sender_id, (unreadDirect.get(message.sender_id) || 0) + 1);
      }
    } catch (error) { console.warn('Could not load unread direct-message counts:', error); }
    if (groups.length) {
      try {
        const { data: groupRows, error: groupUnreadError } = await db.from('group_messages')
          .select('group_id,sender_id,created_at').in('group_id', groups.map(group => group.id))
          .order('created_at', { ascending: false }).limit(2000);
        if (groupUnreadError) throw groupUnreadError;
        for (const message of (groupRows || [])) {
          if (message.sender_id === window.surfCurrentUserId) continue;
          const lastRead = getChatLastRead('group', message.group_id);
          if (Date.parse(message.created_at || 0) > lastRead) unreadGroups.set(message.group_id, (unreadGroups.get(message.group_id) || 0) + 1);
        }
      } catch (error) { console.warn('Could not load unread group-message counts:', error); }
    }
    const friendIds = new Set(requests.filter((item) => item.status === 'accepted').map((item) => item.requester_id === window.surfCurrentUserId ? item.addressee_id : item.requester_id));
    const people = friends.filter((person) => friendIds.has(person.id));
    const newestByPerson = new Map();
    for (const message of messages) {
      const otherId = message.sender_id === window.surfCurrentUserId ? message.recipient_id : message.sender_id;
      const time = Date.parse(message.created_at || 0);
      if (!newestByPerson.has(otherId) || time > newestByPerson.get(otherId)) newestByPerson.set(otherId, time);
    }
    people.sort((a, b) => (newestByPerson.get(b.id) || 0) - (newestByPerson.get(a.id) || 0));
    people.forEach((person) => {
      const row = document.createElement('div');
      row.className = 'person';
      row.dataset.userId = person.id;
      const latest = messages.find((message) => message.sender_id === person.id || message.recipient_id === person.id);
      const copy = document.createElement('div');
      copy.className = 'person-info';
      const name = document.createElement('div'); name.className = 'person-name'; name.textContent = person.display_name || person.username;
      const preview = document.createElement('div'); preview.className = 'preview'; preview.textContent = latest?.body || 'Start a conversation';
      const time = document.createElement('div'); time.className = `presence-dot ${person.status || 'offline'}`; time.title = statusLabel(person.status); time.setAttribute('aria-label', statusLabel(person.status));
      copy.append(name, preview);
      row.append(avatarNode(person), copy, time);
      addUnreadBadge(row, unreadDirect.get(person.id) || 0);
      row.onclick = () => selectLivePerson(row, person);
      list.append(row);
    });
    groups.forEach((group) => {
      const row = document.createElement('div'); row.className = 'person'; row.dataset.groupId = group.id;
      const icon = document.createElement('span'); icon.className = 'avatar'; icon.textContent = group.avatar_path ? '' : 'G';
      if (group.avatar_path) { icon.style.backgroundImage = `url("${db.storage.from('surf-group-assets').getPublicUrl(group.avatar_path).data.publicUrl}")`; icon.style.backgroundSize = 'cover'; icon.style.backgroundPosition = 'center'; }
      const copy = document.createElement('div'); copy.className = 'person-info';
      const name = document.createElement('div'); name.className = 'person-name'; name.textContent = group.name;
      const preview = document.createElement('div'); preview.className = 'preview'; preview.textContent = 'Group conversation';
      copy.append(name, preview); row.append(icon, copy); row.onclick = () => selectLiveGroup(row, group); row.ondblclick = (event) => { event.preventDefault(); openGroupDetails(group); }; row.title = 'Open group chat';
      const details = document.createElement('button'); details.type = 'button'; details.className = 'group-row-details'; details.textContent = '•••'; details.title = 'Group settings and members'; details.setAttribute('aria-label', 'Open ' + group.name + ' settings');
      details.style.cssText = 'margin-left:auto;align-self:center;background:transparent;color:inherit;border-radius:9px;padding:7px 9px;opacity:.85;flex-shrink:0';
      details.onclick = (event) => { event.preventDefault(); event.stopPropagation(); openGroupDetails(group); };
      addUnreadBadge(row, unreadGroups.get(group.id) || 0);
      row.append(details); list.append(row);
    });
    if (!people.length && !groups.length) setEmpty(list, 'No conversations yet. Use Discover to find people and send a friend request.');
  }

  function clearMessages(message) { setEmpty(document.getElementById('messages'), message); }

  function localReadReceiptsEnabled() {
    return localStorage.getItem('surfPref_readReceipts') !== 'false' && selfProfile?.read_receipts_enabled !== false;
  }

  function updateChatPresence(person) {
    const badge = document.getElementById('chatOnlineBadge');
    const status = document.getElementById('chatStatus');
    if (!badge || !status) return;
    badge.style.display = person?.status === 'online' ? 'inline-flex' : 'none';
    status.textContent = person?.status === 'online' ? '' : statusLabel(person?.status);
  }

  async function markMessagesDelivered(messages, markRead = false) {
    const ids = messages.map((message) => message.id).filter(Boolean);
    if (!ids.length) return;
    const now = new Date().toISOString();
    const changes = { delivered_at: now };
    if (markRead && localReadReceiptsEnabled()) changes.read_at = now;
    const { error } = await db.from('direct_messages').update(changes).in('id', ids).eq('recipient_id', window.surfCurrentUserId);
    if (error) console.warn('Could not update message delivery state.', error);
  }

  function displayMessage(message, person) {
    const list = document.getElementById('messages');
    if (!list) return;
    list.querySelector('.live-empty')?.remove();
    const row = document.createElement('div');
    const mine = message.sender_id === window.surfCurrentUserId;
    row.className = `msgrow${mine ? ' me' : ''}`;
    row.dataset.messageId = message.id || '';
    if (!mine) row.append(avatarNode(person, 'mini-avatar'));
    const wrap = document.createElement('div');
    const bubble = document.createElement('div'); bubble.className = message.media_path ? 'photo-bubble' : 'bubble';
    if (message.media_path) { const img = document.createElement('img'); img.alt = 'Shared photo'; img.style.cssText = 'width:245px;max-width:100%;max-height:300px;object-fit:cover;border-radius:12px;display:block'; db.storage.from('surf-chat-media').createSignedUrl(message.media_path, 3600).then(({data}) => { if (data?.signedUrl) img.src = data.signedUrl; }); bubble.append(img); if (message.body) { const caption = document.createElement('div'); caption.className = 'photo-caption'; caption.textContent = message.body; bubble.append(caption); } } else bubble.textContent = message.body;
    const stamp = document.createElement('div'); stamp.className = 'stamp';
    const sentTime = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    stamp.textContent = mine ? `${sentTime} · ${message.read_at ? 'Read' : message.delivered_at ? 'Delivered' : 'Sent'}` : sentTime;
    wrap.append(bubble, stamp); row.append(wrap); list.append(row); list.scrollTop = list.scrollHeight;
  }

  async function loadDirectMessages(person) {
    clearMessages(`Your conversation with ${person.display_name || person.username} will appear here.`);
    const current = window.surfCurrentUserId;
    const filter = `and(sender_id.eq.${current},recipient_id.eq.${person.id}),and(sender_id.eq.${person.id},recipient_id.eq.${current})`;
    const { data, error } = await db.from('direct_messages').select('id,sender_id,recipient_id,body,media_path,created_at,delivered_at,read_at').or(filter).order('created_at');
    if (error) return safeError(error, 'Could not load this conversation.');
    const incoming = (data || []).filter((message) => message.sender_id === person.id && (!message.delivered_at || (localReadReceiptsEnabled() && !message.read_at)));
    if (incoming.length) {
      const changes = { delivered_at: new Date().toISOString() };
      if (localReadReceiptsEnabled()) changes.read_at = new Date().toISOString();
      await db.from('direct_messages').update(changes).in('id', incoming.map((message) => message.id)).eq('recipient_id', current);
      incoming.forEach((message) => { message.delivered_at ||= changes.delivered_at; if (changes.read_at) message.read_at = changes.read_at; });
    }
    const list = document.getElementById('messages'); list.innerHTML = '';
    if (!data?.length) return clearMessages('No messages yet. Say hello!');
    data.forEach((message) => displayMessage(message, person));
  }

  async function selectLivePerson(row, person) {
    document.querySelectorAll('#chatList .person').forEach((item) => item.classList.remove('selected'));
    row.classList.add('selected');
    window.surfActiveRecipientId = person.id; window.surfActiveGroupId = null;
    document.getElementById('chatName').textContent = person.display_name || person.username;
    document.getElementById('chatName').title = 'Open profile'; document.getElementById('chatName').style.cursor = 'pointer'; document.getElementById('chatName').onclick = openProfileForCurrentChat;
    document.getElementById('chatAvatar').title = 'Open profile'; document.getElementById('chatAvatar').style.cursor = 'pointer'; document.getElementById('chatAvatar').onclick = openProfileForCurrentChat;
    const avatar = document.getElementById('chatAvatar');
    const avatarUrl = profileAssetUrl(person.avatar_path);
    avatar.textContent = avatarUrl ? '' : initials(person);
    avatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
    avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; avatar.style.display = 'grid';
    updateChatPresence(person);
    document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = false; });
    document.getElementById('blockedNotice').style.display = 'none';
    app.classList.add('show-chat');
    markChatReadLocally('direct', person.id);
    await loadDirectMessages(person);
    renderChatList();
  }

  async function selectLiveGroup(row, group) {
    document.querySelectorAll('#chatList .person').forEach((item) => item.classList.remove('selected'));
    row.classList.add('selected');
    window.surfActiveRecipientId = null;
    window.surfActiveGroupId = group.id;
    window.surfActiveGroup = group;
    const nameNode = document.getElementById('chatName'); if (nameNode) nameNode.textContent = group.name || 'Group';
    const avatarNodeEl = document.getElementById('chatAvatar');
    if (avatarNodeEl) {
      avatarNodeEl.textContent = group.avatar_path ? '' : (group.name || 'G').slice(0,1).toUpperCase();
      avatarNodeEl.style.backgroundImage = group.avatar_path ? `url("${db.storage.from('surf-group-assets').getPublicUrl(group.avatar_path).data.publicUrl}")` : '';
      avatarNodeEl.style.backgroundSize = 'cover'; avatarNodeEl.style.backgroundPosition = 'center'; avatarNodeEl.style.display = 'grid';
    }
    const statusNode = document.getElementById('chatStatus'); if (statusNode) statusNode.textContent = 'Loading members…';
    const badge = document.getElementById('chatOnlineBadge'); if (badge) badge.style.display = 'none';
    document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = false; });
    app.classList.add('show-chat'); clearMessages('Loading group messages…');
    markChatReadLocally('group', group.id);
    const [{ data: memberships, error: memberError }, { data: data, error }] = await Promise.all([
      db.from('group_members').select('user_id,role').eq('group_id', group.id),
      db.from('group_messages').select('id,sender_id,body,created_at').eq('group_id', group.id).order('created_at', { ascending: true })
    ]);
    if (memberError) return safeError(memberError, 'Could not load group members. Run the group-management migration and check group membership permissions.');
    if (error) return safeError(error, 'Could not load this group. Check group message permissions.');
    const memberIds = [...new Set((memberships || []).map(m => m.user_id))];
    let memberProfiles = [];
    if (memberIds.length) {
      const result = await db.from('profiles').select('id,username,display_name,avatar_path,status').in('id', memberIds);
      if (!result.error) memberProfiles = result.data || [];
    }
    const byId = new Map(memberProfiles.map(p => [p.id,p]));
    if (statusNode) statusNode.textContent = `${memberIds.length || 1} member${(memberIds.length || 1) === 1 ? '' : 's'}`;
    const list = document.getElementById('messages'); list.innerHTML = '';
    if (!data?.length) { clearMessages('No messages yet. Say hello!'); renderChatList(); return; }
    data.forEach((message) => {
      const profile = byId.get(message.sender_id);
      displayMessage(message, message.sender_id === window.surfCurrentUserId ? null : { username: profile?.display_name || profile?.username || 'Member', display_name: profile?.display_name, avatar_path: profile?.avatar_path, id: profile?.id });
    });
    list.scrollTop = list.scrollHeight;
    renderChatList();
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
    playMessageSendTone();
    renderChatList();
    return true;
  }


  async function sendLiveImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (!window.surfCurrentUserId || !window.surfActiveRecipientId || window.surfActiveGroupId) return toast('Choose a direct conversation before sending a photo.');
    if (file.size > 10 * 1024 * 1024) return toast('Choose an image smaller than 10 MB.');
    const sender = window.surfCurrentUserId, recipient = window.surfActiveRecipientId;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo.jpg';
    const path = `${sender}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from('surf-chat-media').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return safeError(uploadError, 'Could not upload this photo. Run the chat-media SQL migration first.');
    const { data, error } = await db.from('direct_messages').insert({ sender_id: sender, recipient_id: recipient, body: '', media_path: path }).select('id,sender_id,recipient_id,body,media_path,created_at,delivered_at,read_at').single();
    if (error) { await db.storage.from('surf-chat-media').remove([path]); return safeError(error, 'Could not send this photo.'); }
    displayMessage(data, findPerson(recipient)); renderChatList(); toast('Photo sent.');
  }

  function bindChatPhotoUpload() {
    const input = document.getElementById('photoInput');
    if (input && !input.dataset.liveBound) { input.dataset.liveBound = '1'; input.addEventListener('change', async () => { const file = input.files?.[0]; input.value = ''; if (file) await sendLiveImage(file); }); }
  }

  function playMessageSendTone() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      window.surfMessageAudioContext ||= new AudioContextClass();
      const ctx = window.surfMessageAudioContext;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [[660, 0], [880, 0.075]].forEach(([frequency, offset]) => {
        const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset); gain.gain.exponentialRampToValueAtTime(0.035, now + offset + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
        oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(now + offset); oscillator.stop(now + offset + 0.13);
      });
    } catch {}
  }

  function subscribeMessages() {
    if (messageChannel) db.removeChannel(messageChannel);
    messageChannel = db.channel('surf-live-messages-' + window.surfCurrentUserId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${window.surfCurrentUserId}` }, async (payload) => {
        const person = findPerson(payload.new.sender_id);
        const isOpen = payload.new.sender_id === window.surfActiveRecipientId;
        await markMessagesDelivered([payload.new], isOpen);
        const now = new Date().toISOString();
        if (isOpen) {
          markChatReadLocally('direct', payload.new.sender_id);
          displayMessage({ ...payload.new, delivered_at: now, read_at: isOpen && localReadReceiptsEnabled() ? now : null }, person);
        }
        renderChatList();
        scheduleNotificationRefresh();
      }).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, async (payload) => {
        if (payload.new.group_id === window.surfActiveGroupId && payload.new.sender_id !== window.surfCurrentUserId) markChatReadLocally('group', payload.new.group_id);
        renderChatList();
        if (payload.new.group_id === window.surfActiveGroupId && payload.new.sender_id !== window.surfCurrentUserId) {
          const { data: sender } = await db.from('profiles').select('id,username,display_name,avatar_path').eq('id', payload.new.sender_id).maybeSingle();
          displayMessage(payload.new, { username: sender?.display_name || sender?.username || 'Member', display_name: sender?.display_name, avatar_path: sender?.avatar_path, id: sender?.id });
        }
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: 'addressee_id=eq.' + window.surfCurrentUserId }, () => { scheduleNotificationRefresh(); scheduleRelationshipRefresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: 'requester_id=eq.' + window.surfCurrentUserId }, () => { scheduleNotificationRefresh(); scheduleRelationshipRefresh(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
          const changed = payload.new;
          if (!changed?.id) return;
          if (changed.id === window.surfCurrentUserId) selfProfile = { ...(selfProfile || {}), ...changed };
          const friend = friends.find(person => person.id === changed.id);
          if (friend) Object.assign(friend, { status: changed.status, display_name: changed.display_name, username: changed.username, avatar_path: changed.avatar_path });
          if (friend) {
            renderChatList();
            loadFriendsAndRequests();
            if (window.surfActiveRecipientId === changed.id) updateChatPresence(friend);
          }
          if (changed.id === window.surfCurrentUserId) {
            const status = changed.status || 'offline';
            document.querySelectorAll('[data-presence]').forEach(button => button.classList.toggle('selected', button.dataset.presence === status));
            const labels = { online: 'Online', dnd: 'Do not disturb', offline: 'Offline' };
            const label = document.getElementById('myPresenceText'); if (label) label.textContent = labels[status] || 'Offline';
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `sender_id=eq.${window.surfCurrentUserId}` }, (payload) => {
          if (payload.new.recipient_id !== window.surfActiveRecipientId) return;
          const person = findPerson(payload.new.recipient_id); if (person) loadDirectMessages(person);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'story_likes' }, async (payload) => {
          scheduleNotificationRefresh();
          const current = activeStoryCollection?.[activeStoryIndex];
          if (current?.id !== payload.new.story_id || payload.new.user_id === window.surfCurrentUserId) return;
          const { data: liker } = await db.from('profiles').select('id,username,display_name,avatar_path').eq('id', payload.new.user_id).maybeSingle();
          if (liker) animateStoryLike(liker);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'story_views' }, (payload) => {
          const current = activeStoryCollection?.[activeStoryIndex];
          if (current?.id === payload.new.story_id && activeStoryProfile?.id === window.surfCurrentUserId) refreshStoryViewerCount(current.id);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stories' }, () => scheduleNotificationRefresh())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, () => scheduleNotificationRefresh())
        .subscribe();
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
    document.getElementById('pendingCount').textContent = String(friends.filter((item) => item.relation.status === 'pending').length);
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
          const chat = document.createElement('button'); chat.className = 'friend-request-action accept'; chat.title = 'Message'; chat.setAttribute('aria-label', 'Message ' + (person.display_name || person.username)); chat.textContent = '✉'; chat.onclick = () => { closeModal('friendsModal'); const chatRow = document.querySelector(`#chatList [data-user-id="${person.id}"]`); if (chatRow) selectLivePerson(chatRow, person); }; row.append(chat);
        }
        section.append(row);
      });
      list.append(section);
    });
    if (!list.children.length) setEmpty(list, activeFriendTab === 'pending' ? 'No pending friend requests.' : 'No friends to show yet. Use Discover to find people.');
  }

  async function answerRequest(relation, accepted) {
    const { data, error } = await db.from('friend_requests').update({ status: accepted ? 'accepted' : 'declined', updated_at: new Date().toISOString() }).eq('id', relation.id).eq('status', 'pending').select('id,status').maybeSingle();
    if (error) return safeError(error, 'Could not update the friend request. Check the friend-request database policies.');
    if (!data) { await loadLiveSurfWorkspace(); return toast('This request has already changed. The list has been refreshed.'); }
    await loadLiveSurfWorkspace(); await refreshNotifications(false); toast(accepted ? 'Friend request accepted.' : 'Friend request declined.');
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
      db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path,is_minor,social_links').neq('id', window.surfCurrentUserId).ilike('username', `%${term}%`).limit(20),
      db.from('profiles').select('id,username,display_name,bio,status,created_at,avatar_path,banner_path,is_minor,social_links').neq('id', window.surfCurrentUserId).ilike('display_name', `%${term}%`).limit(20)
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

  function preferredRelationship(matches, userId = window.surfCurrentUserId) {
    return [...matches].sort((a, b) => {
      const rank = (row) => row.status === 'accepted' ? 4 : row.status === 'pending' && row.addressee_id === userId ? 3 : row.status === 'pending' ? 2 : 1;
      return rank(b) - rank(a) || Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at);
    })[0];
  }

  async function requestStatus(personId) {
    const matches = requests.filter((item) => (item.requester_id === personId && item.addressee_id === window.surfCurrentUserId) || (item.addressee_id === personId && item.requester_id === window.surfCurrentUserId));
    const row = matches.length ? preferredRelationship(matches) : null;
    if (!row) return 'none';
    return row.status === 'pending' ? (row.requester_id === window.surfCurrentUserId ? 'sent' : 'received') : row.status;
  }

  async function openLiveProfile(person) {
    activeProfile = person;
    const avatarUrl = profileAssetUrl(person.avatar_path);
    const discoverAvatar = document.getElementById('discoverAvatar');
    discoverAvatar.textContent = avatarUrl ? '' : initials(person);
    discoverAvatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
    discoverAvatar.style.backgroundSize = 'cover'; discoverAvatar.style.backgroundPosition = 'center';
    const discoverBanner = document.getElementById('discoverBanner');
    discoverBanner.style.backgroundImage = person.banner_path ? `url("${profileAssetUrl(person.banner_path)}")` : '';
    discoverBanner.style.backgroundSize = 'cover'; discoverBanner.style.backgroundPosition = 'center';
    document.getElementById('discoverName').textContent = person.display_name || person.username;
    document.getElementById('discoverHandle').textContent = '@' + person.username + ' · ' + statusLabel(person.status).toLowerCase();
    document.getElementById('discoverBio').textContent = person.bio || 'No bio yet.';
    const discoverAge = document.getElementById('discoverAgeBadge'); if (discoverAge) { discoverAge.textContent = person.is_minor ? '🧒 Minor' : '18+'; discoverAge.style.display = 'inline-flex'; }
    renderSocialLinks(document.getElementById('discoverSocialLinks'), person.social_links);
    const discoverCountNodes = ['discoverPosts', 'discoverFollowers', 'discoverFollowing'].map((id) => document.getElementById(id));
    discoverCountNodes.forEach((node) => { if (node) node.textContent = '…'; });
    const [postsCount, followersCount, followingCount] = await Promise.all([
      db.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', person.id),
      db.from('surf_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', person.id),
      db.from('surf_follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', person.id)
    ]);
    // Do not let a slower request for a previous profile overwrite the currently opened profile.
    if (activeProfile?.id === person.id) {
      const errors = [postsCount.error, followersCount.error, followingCount.error].filter(Boolean);
      if (errors.length) {
        errors.forEach((error) => console.error('Profile count query failed:', error));
        discoverCountNodes.forEach((node) => { if (node) node.textContent = '—'; });
      } else {
        [postsCount.count, followersCount.count, followingCount.count].forEach((count, index) => {
          if (discoverCountNodes[index]) discoverCountNodes[index].textContent = String(count ?? 0);
        });
      }
    }
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
    const matches = requests.filter((item) => (item.requester_id === activeProfile.id && item.addressee_id === window.surfCurrentUserId) || (item.addressee_id === activeProfile.id && item.requester_id === window.surfCurrentUserId));
    const match = matches.length ? preferredRelationship(matches) : null;
    if (state === 'none' || state === 'declined' || state === 'cancelled') {
      result = await db.from('friend_requests').insert({ requester_id: window.surfCurrentUserId, addressee_id: activeProfile.id });
    } else if (state === 'sent') {
      result = await db.from('friend_requests').delete().eq('id', match.id);
    } else if (state === 'received') {
      result = await db.from('friend_requests').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', match.id);
    } else if (state === 'accepted') {
      if (!confirm(`Are you sure you want to unfriend ${activeProfile.display_name || activeProfile.username}?`)) return;
      result = await db.from('friend_requests').delete().eq('id', match.id);
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


  const socialPlatforms = {
    youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'], icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.7V8.3l6.3 3.7-6.3 3.7Z"/></svg>' },
    tiktok: { label: 'TikTok', hosts: ['tiktok.com'], icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 6.7a4.8 4.8 0 0 1-3.8-4.2V2h-3.5v13.7a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.4a6.7 6.7 0 1 0 5.5 6.6V9a8.3 8.3 0 0 0 4.8 1.5V7.1c-.3 0-.7-.1-1-.4Z"/></svg>' },
    spotify: { label: 'Spotify', hosts: ['spotify.com'], icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5A10.5 10.5 0 1 0 12 22.5 10.5 10.5 0 0 0 12 1.5Zm4.8 15.2a.8.8 0 0 1-1.1.3 11.3 11.3 0 0 0-8.6-1 .8.8 0 1 1-.5-1.5 12.8 12.8 0 0 1 9.9 1.1c.4.2.5.7.3 1.1Zm1.3-3a1 1 0 0 1-1.3.4 13.9 13.9 0 0 0-10.3-1.2 1 1 0 1 1-.6-1.9 15.9 15.9 0 0 1 11.8 1.4 1 1 0 0 1 .4 1.3Zm.1-3.1A16.8 16.8 0 0 0 5.6 9a1.2 1.2 0 1 1-.7-2.3 19.1 19.1 0 0 1 14.2 1.7 1.2 1.2 0 0 1-.9 2.2Z"/></svg>' }
  };

  function validSocialUrl(platform, value) {
    const config = socialPlatforms[platform];
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (url.protocol !== 'https:' || !config || !config.hosts.some((domain) => host === domain || host.endsWith('.' + domain))) return '';
      return url.href;
    } catch { return ''; }
  }

  function renderSocialLinks(container, links) {
    if (!container) return;
    container.replaceChildren();
    Object.entries(socialPlatforms).forEach(([platform, config]) => {
      const url = validSocialUrl(platform, links?.[platform]);
      if (!url) return;
      const anchor = document.createElement('a');
      anchor.className = 'link-badge';
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.setAttribute('aria-label', 'Open ' + config.label + ' profile');
      anchor.title = config.label;
      anchor.innerHTML = config.icon + '<span>' + config.label + '</span>';
      container.append(anchor);
    });
    container.style.display = container.children.length ? 'flex' : 'none';
  }

  function renderSocialAccountSettings() {
    const links = selfProfile?.social_links || {};
    document.querySelectorAll('#accountsModal [data-platform]').forEach((row) => {
      const platform = row.dataset.platform, config = socialPlatforms[platform], url = validSocialUrl(platform, links[platform]);
      const label = row.querySelector('.account-meta span'), button = row.querySelector('.account-action'), icon = row.querySelector('.account-icon');
      if (icon && config) icon.innerHTML = config.icon;
      if (label) label.textContent = url || 'Not linked';
      if (button) button.textContent = url ? 'Unlink' : 'Link';
    });
  }

  async function toggleSocialAccount(platform, button) {
    const config = socialPlatforms[platform];
    if (!config || !selfProfile?.id) return toast('Sign in to manage linked accounts.');
    const links = { ...(selfProfile.social_links || {}) };
    if (validSocialUrl(platform, links[platform])) delete links[platform];
    else {
      const value = prompt('Paste your ' + config.label + ' profile URL (for example, https://www.' + config.hosts[0] + '/yourname):');
      if (value === null) return;
      const url = validSocialUrl(platform, value);
      if (!url) return toast('Enter a secure ' + config.label + ' profile link.');
      links[platform] = url;
    }
    const { data, error } = await db.from('profiles').update({ social_links: links, updated_at: new Date().toISOString() }).eq('id', selfProfile.id).select('id').maybeSingle();
    if (error) return safeError(error, 'Could not save the linked account. Run the updated schema.sql, then try again.');
    if (!data) return toast('Your profile could not be found. Sign in again and retry.');
    selfProfile = { ...selfProfile, social_links: links };
    renderSocialAccountSettings();
    renderSocialLinks(document.getElementById('pageSocialLinks'), links);
    toast(links[platform] ? config.label + ' profile linked.' : config.label + ' profile unlinked.');
  }

  function normalizeRailTooltips() {
    document.querySelectorAll('.rail .navbtn').forEach((button) => {
      const label = button.dataset.tooltip || button.getAttribute('title');
      if (label) button.dataset.tooltip = label;
      button.removeAttribute('title');
    });
  }

  const notificationSeenKey = () => 'surf-notifications-seen:' + window.surfCurrentUserId;

  function scheduleNotificationRefresh() {
    clearTimeout(notificationRefreshTimer);
    notificationRefreshTimer = setTimeout(() => refreshNotifications(false), 350);
  }

  function scheduleRelationshipRefresh() {
    clearTimeout(workspaceRefreshTimer);
    workspaceRefreshTimer = setTimeout(() => loadLiveSurfWorkspace(), 350);
  }

  function renderNotifications() {
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.replaceChildren();
    if (!notificationItems.length) return setEmpty(list, 'You’re all caught up. Friend requests, friends’ posts, and story likes will show here.');
    const lastSeen = Date.parse(localStorage.getItem(notificationSeenKey()) || '');
    notificationItems.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'notification-item' + (Date.parse(item.created_at) > lastSeen ? ' unread' : '');
      const avatar = avatarNode(item.actor || { username: '?' }, 'notification-item-avatar');
      const url = profileAssetUrl(item.actor?.avatar_path);
      if (url) { avatar.textContent = ''; avatar.style.backgroundImage = 'url("' + url + '")'; }
      const copy = document.createElement('span'); copy.className = 'notification-item-copy';
      copy.append(document.createTextNode(item.text));
      const time = document.createElement('small'); time.textContent = new Date(item.created_at).toLocaleString(); copy.append(time);
      const dot = document.createElement('i'); dot.className = 'notification-item-dot';
      if (Date.parse(item.created_at) <= lastSeen) dot.style.visibility = 'hidden';
      row.append(avatar, copy, dot);
      row.onclick = () => handleNotification(item);
      list.append(row);
    });
  }

  async function refreshNotifications(markRead) {
    const userId = window.surfCurrentUserId;
    if (!userId) return;
    const seenKey = notificationSeenKey();
    if (!localStorage.getItem(seenKey)) localStorage.setItem(seenKey, new Date().toISOString());
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [requestResult, likeResult, postResult] = await Promise.all([
      db.from('friend_requests').select('id,requester_id,addressee_id,status,created_at,updated_at').or(`addressee_id.eq.${userId},requester_id.eq.${userId}`).in('status', ['pending','accepted']).gte('created_at', since).order('created_at', { ascending: false }).limit(40),
      db.from('story_likes').select('story_id,user_id,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(60),
      db.from('posts').select('id,owner_id,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(80)
    ]);
    const failed = [requestResult, likeResult, postResult].find((result) => result.error);
    if (failed) return safeError(failed.error, 'Could not load notifications.');
    const actors = [];
    (requestResult.data || []).filter(row => row.addressee_id === userId && row.requester_id !== userId).forEach((row) => actors.push({ id: row.requester_id, kind: 'request', row, created_at: row.created_at, text: row.status === 'accepted' ? 'is now your friend' : 'sent you a friend request' }));
    const friendIds = new Set(friends.filter((person) => person.relation.status === 'accepted').map((person) => person.id));
    (postResult.data || []).filter((row) => row.owner_id !== userId && friendIds.has(row.owner_id)).forEach((row) => actors.push({ id: row.owner_id, kind: 'post', row, created_at: row.created_at, text: 'shared a new post' }));
    const likes = (likeResult.data || []).filter((row) => row.user_id !== userId);
    if (likes.length) {
      const storyIds = [...new Set(likes.map((row) => row.story_id))];
      const { data: likedStories, error: storyError } = await db.from('stories').select('id,owner_id').in('id', storyIds).eq('owner_id', userId);
      if (storyError) return safeError(storyError, 'Could not load story likes.');
      const ownStoryIds = new Set((likedStories || []).map((story) => story.id));
      likes.filter((row) => ownStoryIds.has(row.story_id)).forEach((row) => actors.push({ id: row.user_id, kind: 'story-like', row, created_at: row.created_at, text: 'liked your story' }));
    }
    const ids = [...new Set(actors.map((item) => item.id))];
    let people = new Map();
    if (ids.length) {
      const { data, error } = await db.from('profiles').select('id,username,display_name,bio,status,avatar_path,banner_path,is_minor,social_links').in('id', ids);
      if (error) return safeError(error, 'Could not load notification profiles.');
      people = new Map((data || []).map((profile) => [profile.id, profile]));
    }
    notificationItems = actors.map((item) => ({ ...item, actor: people.get(item.id) })).filter((item) => item.actor).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (markRead) localStorage.setItem(seenKey, new Date().toISOString());
    const lastSeen = Date.parse(localStorage.getItem(seenKey) || '');
    const unread = notificationItems.filter((item) => Date.parse(item.created_at) > lastSeen).length;
    const badge = document.getElementById('notificationCount');
    if (badge) { badge.textContent = unread > 99 ? '99+' : String(unread); badge.style.display = unread ? 'grid' : 'none'; }
    renderNotifications();
  }

  async function openNotifications() {
    openModal('notificationsModal');
    await refreshNotifications(true);
  }

  async function handleNotification(item) {
    closeModal('notificationsModal');
    localStorage.setItem(notificationSeenKey(), new Date().toISOString());
    refreshNotifications(false);
    const actor = item.actor;
    if (item.kind === 'story-like') {
      await loadStories();
      const index = yourStories.findIndex((story) => story.id === item.row.story_id);
      if (index >= 0) { openLiveStory({ owner: selfProfile, items: yourStories, isYours: true }); activeStoryIndex = index; renderLiveStoryViewer(); }
      return;
    }
    if (item.kind === 'request') { await loadLiveSurfWorkspace(); return openLiveProfile({ ...actor, ...(friends.find((friend) => friend.id === actor.id) || {}) }); }
    if (item.kind === 'post') return openLiveProfile({ ...actor, ...(friends.find((friend) => friend.id === actor.id) || {}) });
  }

  function renderStoriesStrip() {
    const strip = document.querySelector('.stories');
    if (!strip) return;
    [...strip.children].forEach((item) => { if (item.id !== 'yourStoryCard') item.remove(); });
    storySets.forEach((entry) => {
      const item = document.createElement('div'); item.className = 'story'; item.tabIndex = 0;
      const wrap = document.createElement('div'); wrap.className = 'avatar-wrap';
      const avatar = avatarNode(entry.owner); wrap.append(avatar);
      const name = document.createElement('span'); name.textContent = entry.owner.display_name || entry.owner.username;
      item.append(wrap, name); item.onclick = () => openLiveStory(entry); strip.append(item);
    });
  }

  async function loadStories() {
    const { data, error } = await db.from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
    if (error) throw error;
    const stories = data || [];
    const ownerIds = [...new Set(stories.map((story) => story.owner_id))];
    let profileMap = new Map();
    if (ownerIds.length) {
      const { data: profiles, error: profileError } = await db.from('profiles').select('id,username,display_name,status,avatar_path').in('id', ownerIds);
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
      avatar.className = 'avatar';
      avatar.style.backgroundColor = '';
      const avatarUrl = profileAssetUrl(selfProfile?.avatar_path);
      avatar.style.backgroundImage = avatarUrl ? 'url("' + avatarUrl + '")' : '';
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
      avatar.textContent = avatarUrl ? '' : initials(selfProfile || {});
      document.getElementById('yourStoryLabel').textContent = own.length ? 'Your story · view' : 'Your story · share a moment';
    }
    const grouped = new Map();
    stories.filter((item) => item.owner_id !== window.surfCurrentUserId).forEach((story) => {
      const owner = profileMap.get(story.owner_id); if (!owner) return;
      if (!grouped.has(owner.id)) grouped.set(owner.id, { owner, items: [], time: 'recently' });
      grouped.get(owner.id).items.push(story);
    });
    storySets = [...grouped.values()];
    renderStoriesStrip();
    try { await loadStoryHighlights(); } catch (highlightError) { console.warn('Could not load saved highlights.', highlightError); }
  }

  async function openLiveStory(entry) {
    activeStoryCollection = entry.items; activeStoryOwner = entry.isYours ? 'Your story' : entry.owner.display_name || entry.owner.username;
    activeStoryProfile = entry.isYours ? selfProfile : entry.owner;
    activeStoryEmoji = initials(activeStoryProfile || entry.owner || {}); activeStoryIndex = 0; activeStoryViewId = null;
    likedStoryIds.clear();
    renderLiveStoryViewer(); openModal('storyViewer');
    if (window.surfCurrentUserId && entry.items.length) {
      const { data } = await db.from('story_likes').select('story_id').eq('user_id', window.surfCurrentUserId).in('story_id', entry.items.map((story) => story.id));
      (data || []).forEach((like) => likedStoryIds.add(like.story_id));
      renderLiveStoryViewer();
    }
  }

  function renderLiveStoryViewer() {
    const story = activeStoryCollection?.[activeStoryIndex]; if (!story) return;
    clearTimeout(storyAdvanceTimer);
    const image = document.getElementById('storyViewerImage'), text = document.getElementById('storyViewerText');
    image.style.display = story.kind === 'image' ? 'block' : 'none'; text.style.display = story.kind === 'text' ? 'grid' : 'none';
    if (story.kind === 'image') { image.src = story.url; text.textContent = ''; }
    else { text.textContent = story.body; text.style.background = story.background_color; }
    document.getElementById('storyViewerName').textContent = activeStoryOwner;
    const storyAvatar = document.getElementById('storyViewerAvatar'), storyAvatarUrl = profileAssetUrl(activeStoryProfile?.avatar_path);
    storyAvatar.textContent = storyAvatarUrl ? '' : activeStoryEmoji;
    storyAvatar.style.backgroundImage = storyAvatarUrl ? `url("${storyAvatarUrl}")` : '';
    document.getElementById('storyViewerCount').textContent = `${activeStoryIndex + 1} / ${activeStoryCollection.length}`;
    const progress = document.getElementById('storyProgress');
    const progressSequence = ++storyProgressSequence;
    progress.style.setProperty('--story-progress', '0%');
    progress.classList.remove('is-advancing');
    void progress.offsetWidth;
    requestAnimationFrame(() => { if (progressSequence === storyProgressSequence) progress.classList.add('is-advancing'); });
    storyAdvanceTimer = setTimeout(() => {
      if (activeStoryIndex < activeStoryCollection.length - 1) stepLiveStory(1);
      else closeModal('storyViewer');
    }, 3000);
    document.querySelector('.story-prev').style.display = activeStoryIndex > 0 ? 'grid' : 'none';
    document.querySelector('.story-next').style.display = activeStoryIndex < activeStoryCollection.length - 1 ? 'grid' : 'none';
    const isOwnStory = activeStoryProfile?.id === window.surfCurrentUserId;
    document.querySelector('.story-viewer-add').style.display = isOwnStory ? 'block' : 'none';
    document.getElementById('storyOwnMoreButton').style.display = isOwnStory ? 'grid' : 'none';
    document.getElementById('storyOwnMenu').style.display = 'none';
    document.getElementById('storyLikeButton').style.display = isOwnStory ? 'none' : 'inline-flex';
    document.getElementById('storyReplyButton').style.display = isOwnStory ? 'none' : 'inline-flex';
    document.getElementById('storyLikeButton').classList.toggle('liked', likedStoryIds.has(story.id));
    if (story.id !== activeStoryViewId) { activeStoryViewId = story.id; recordStoryView(story.id); }
    if (isOwnStory) refreshStoryViewerCount(story.id);
  }

  async function stepLiveStory(direction) {
    if (!activeStoryCollection?.length) return;
    const next = activeStoryIndex + direction;
    if (next < 0 || next >= activeStoryCollection.length) return;
    activeStoryIndex = next; activeStoryViewId = null; renderLiveStoryViewer();
  }

  async function recordStoryView(storyId) {
    if (!storyId || !window.surfCurrentUserId || activeStoryProfile?.id === window.surfCurrentUserId) return;
    const { error } = await db.from('story_views').upsert({ story_id: storyId, viewer_id: window.surfCurrentUserId }, { onConflict: 'story_id,viewer_id', ignoreDuplicates: true });
    if (error) console.warn('Could not record story view.', error);
  }

  async function refreshStoryViewerCount(storyId) {
    const { count, error } = await db.from('story_views').select('viewer_id', { count: 'exact', head: true }).eq('story_id', storyId);
    if (!error) document.getElementById('storyViewerTotal').textContent = String(count || 0);
  }

  async function openStoryViewers() {
    const story = activeStoryCollection?.[activeStoryIndex];
    if (!story || activeStoryProfile?.id !== window.surfCurrentUserId) return;
    const list = document.getElementById('storyViewersList'); list.replaceChildren();
    openModal('storyViewersModal');
    const { data: views, error } = await db.from('story_views').select('viewer_id').eq('story_id', story.id);
    if (error) return safeError(error, 'Could not load story viewers.');
    const ids = [...new Set((views || []).map((view) => view.viewer_id))];
    if (!ids.length) return setEmpty(list, 'No viewers yet.');
    const { data: people, error: profileError } = await db.from('profiles').select('id,username,display_name,avatar_path').in('id', ids);
    if (profileError) return safeError(profileError, 'Could not load viewer profiles.');
    (people || []).forEach((person) => {
      const row = document.createElement('div'); row.className = 'story-viewer-person';
      row.append(avatarNode(person)); const name = document.createElement('span'); name.textContent = person.display_name || person.username; row.append(name); list.append(row);
    });
  }

  async function openStoryArchive() {
    openModal('storyArchiveModal');
    try { await loadStoryHighlights(); } catch (error) { safeError(error, 'Could not load story highlights.'); }
    const list = document.getElementById('storyArchiveList'); list.replaceChildren();
    const { data, error } = await db.from('stories').select('*').eq('owner_id', window.surfCurrentUserId).order('created_at', { ascending: false });
    if (error) return safeError(error, 'Could not load your story archive.');
    archivedStories = data || [];
    if (!archivedStories.length) return setEmpty(list, 'Stories you share will be saved here after they expire.');
    for (const story of archivedStories) {
      if (story.media_path) {
        const { data: signed } = await db.storage.from('surf-stories').createSignedUrl(story.media_path, 3600);
        story.url = signed?.signedUrl || '';
      }
      const row = document.createElement('article'); row.className = 'archive-story-row';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'archive-story-preview';
      if (story.url) { const image = document.createElement('img'); image.src = story.url; image.alt = 'Archived story'; preview.append(image); }
      else { preview.textContent = story.body || 'Text story'; preview.style.background = story.background_color || '#51419b'; }
      preview.onclick = () => { closeModal('storyArchiveModal'); openLiveStory({ owner: selfProfile, items: [story], isYours: true }); };
      const actions = document.createElement('div'); actions.className = 'archive-story-actions';
      const viewers = document.createElement('button'); viewers.type = 'button'; viewers.textContent = 'Viewers'; viewers.onclick = () => openStoryViewersFor(story.id);
      const highlight = document.createElement('button'); highlight.type = 'button'; highlight.textContent = '＋ Highlight'; highlight.onclick = () => addStoryToHighlight(story);
      actions.append(viewers, highlight); row.append(preview, actions); list.append(row);
    }
  }

  async function openStoryViewersFor(storyId) {
    const story = archivedStories.find((item) => item.id === storyId); if (!story) return;
    activeStoryCollection = [story]; activeStoryProfile = selfProfile; activeStoryIndex = 0;
    return openStoryViewers();
  }

  async function addStoryToHighlight(story) {
    window.pendingHighlightStory = story;
    const input = document.getElementById('highlightNameInput');
    if (input) input.value = '';
    openModal('highlightNameModal');
  }

  async function saveStoryHighlight() {
    const story = window.pendingHighlightStory;
    const title = (document.getElementById('highlightNameInput')?.value || '').trim();
    if (!story || !title) return toast('Enter a name for this highlight.');
    const { error } = await db.from('story_highlights').insert({ owner_id: window.surfCurrentUserId, story_id: story.id, title });
    if (error) return safeError(error, 'Could not add this story to highlights.');
    window.pendingHighlightStory = null;
    closeModal('highlightNameModal');
    try { await loadStoryHighlights(); } catch (loadError) { console.warn(loadError); }
    toast('Added to highlights.');
  }

  function toggleStoryOwnMenu(event) {
    event?.stopPropagation();
    const menu = document.getElementById('storyOwnMenu');
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  }

  async function archiveCurrentStory() {
    const story = activeStoryCollection?.[activeStoryIndex];
    if (!story || activeStoryProfile?.id !== window.surfCurrentUserId) return;
    const { error } = await db.from('stories').update({ expires_at: new Date().toISOString() }).eq('id', story.id).eq('owner_id', window.surfCurrentUserId);
    if (error) return safeError(error, 'Could not archive this story.');
    clearTimeout(storyAdvanceTimer); closeModal('storyViewer');
    await loadStories(); toast('Story moved to your archive.');
  }

  async function deleteCurrentStory() {
    const story = activeStoryCollection?.[activeStoryIndex];
    if (!story || activeStoryProfile?.id !== window.surfCurrentUserId) return;
    if (!confirm('Delete this story? This cannot be undone.')) return;
    const { error } = await db.from('stories').delete().eq('id', story.id).eq('owner_id', window.surfCurrentUserId);
    if (error) return safeError(error, 'Could not delete this story.');
    if (story.media_path) await db.storage.from('surf-stories').remove([story.media_path]);
    clearTimeout(storyAdvanceTimer); closeModal('storyViewer');
    await loadStories(); toast('Story deleted.');
  }

  async function replyToStory() {
    const reply = (prompt('Reply to this story:') || '').trim(); if (!reply) return;
    const recipient = activeStoryProfile?.id;
    if (!recipient || recipient === window.surfCurrentUserId) return toast('You can reply to a friend’s story.');
    const chatRow = document.querySelector(`#chatList [data-user-id="${recipient}"]`);
    if (!chatRow) return toast('Add this person as a friend before replying.');
    closeModal('storyViewer'); selectLivePerson(chatRow, activeStoryProfile); await sendLiveMessage(reply);
  }

  function openPostComposer() {
    if (!window.surfCurrentUserId) return toast('Sign in to create a post.');
    postDraftFile = null; document.getElementById('postMediaInput').value = '';
    document.getElementById('postCaption').value = ''; document.getElementById('postTags').value = '';
    document.getElementById('postMediaPreview').textContent = 'No media selected'; openModal('postComposerModal');
  }

  async function publishPost() {
    const file = postDraftFile; if (!file) return toast('Choose a photo or video first.');
    const caption = document.getElementById('postCaption').value.trim();
    const postId = crypto.randomUUID(); const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || 'post-media';
    const path = `${window.surfCurrentUserId}/${postId}/${safeName}`;
    const { error: uploadError } = await db.storage.from('surf-post-media').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return safeError(uploadError, 'Could not upload this post.');
    const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
    const { error } = await db.from('posts').insert({ id: postId, owner_id: window.surfCurrentUserId, media_path: path, media_type: mediaType, caption });
    if (error) { await db.storage.from('surf-post-media').remove([path]); return safeError(error, 'Could not save this post.'); }
    const tags = [...new Set(document.getElementById('postTags').value.split(',').map((name) => name.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
    if (tags.length) {
      const { data: people, error: peopleError } = await db.from('profiles').select('id,username').in('username', tags);
      if (peopleError) safeError(peopleError, 'Post shared, but tags could not be looked up.');
      else if (people?.length) { const tagResult = await db.from('post_tags').insert(people.map((person) => ({ post_id: postId, tagged_user_id: person.id, tagged_by: window.surfCurrentUserId }))); if (tagResult.error) safeError(tagResult.error, 'Post shared, but tags could not be saved.'); }
    }
    closeModal('postComposerModal'); await loadProfilePosts(window.surfCurrentUserId); await updateOwnCounts(); toast('Post shared.');
  }

  async function loadProfilePosts(ownerId, target = document.getElementById('profileGrid'), view = 'posts') {
    if (!ownerId || !target) return;
    const { data: posts, error } = await db.from('posts').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false });
    if (error) return safeError(error, 'Could not load posts.');
    let visiblePosts = posts || [];
    if (view === 'videos') visiblePosts = visiblePosts.filter((post) => post.media_type === 'video');
    if (view === 'tagged') {
      const { data: tags, error: tagError } = await db.from('post_tags').select('post_id').eq('tagged_user_id', ownerId);
      if (tagError) return safeError(tagError, 'Could not load tagged posts.');
      const taggedIds = new Set((tags || []).map((tag) => tag.post_id));
      visiblePosts = visiblePosts.filter((post) => taggedIds.has(post.id));
    }
    target.replaceChildren();
    for (const post of visiblePosts) {
      const { data: signed } = await db.storage.from('surf-post-media').createSignedUrl(post.media_path, 3600);
      const card = document.createElement('article'); card.className = 'grid-post surf-post-card';
      if (signed?.signedUrl && post.media_type === 'video') { const video = document.createElement('video'); video.src = signed.signedUrl; video.controls = true; card.append(video); }
      else if (signed?.signedUrl) { const image = document.createElement('img'); image.src = signed.signedUrl; image.alt = post.caption || 'Surf post'; card.append(image); }
      const caption = document.createElement('p'); caption.textContent = post.caption; card.append(caption);
      card.tabIndex = 0; card.setAttribute('role','button'); card.setAttribute('aria-label','Open post');
      card.onclick = (event) => { if (event.target.closest('button,video')) return; openPostDetail(post, signed?.signedUrl); };
      if (ownerId === window.surfCurrentUserId) { const del = document.createElement('button'); del.type='button'; del.className='delete-post-button'; del.textContent='Delete'; del.onclick=(event)=>{event.stopPropagation();deleteOwnPost(post);}; card.append(del); }
      target.append(card);
    }
    if (!visiblePosts.length) setEmpty(target, view === 'videos' ? 'No videos yet.' : view === 'tagged' ? 'No tagged posts yet.' : 'No posts yet.');
    if (ownerId === window.surfCurrentUserId) updateOwnCounts();
  }

  async function toggleSavedPost(postId, button) {
    const userId = window.surfCurrentUserId;
    const { data, error } = await db.from('saved_posts').select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
    if (error) return safeError(error, 'Could not check saved posts.');
    const result = data ? await db.from('saved_posts').delete().eq('user_id', userId).eq('post_id', postId) : await db.from('saved_posts').insert({ user_id: userId, post_id: postId });
    if (result.error) return safeError(result.error, 'Could not update saved posts.');
    button.classList.toggle('saved', !data);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h12v16l-6-4-6 4z"/></svg><span>${data ? 'Save' : 'Saved'}</span>`;
  }

  async function deleteOwnPost(post) {
    if (!post || post.owner_id !== window.surfCurrentUserId || !confirm('Delete this post permanently?')) return;
    const { error } = await db.from('posts').delete().eq('id', post.id).eq('owner_id', window.surfCurrentUserId);
    if (error) return safeError(error, 'Could not delete this post. Check the post deletion policy.');
    if (post.media_path) await db.storage.from('surf-post-media').remove([post.media_path]);
    await loadProfilePosts(window.surfCurrentUserId); await updateOwnCounts(); toast('Post deleted.');
  }
  async function openPostDetail(post, mediaUrl) {
    let modal = document.getElementById('postDetailModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id='postDetailModal'; modal.className='modal-back'; modal.style.zIndex='10020';
      modal.innerHTML='<section class="modal post-detail-modal"><button class="close" type="button" data-close aria-label="Close post">×</button><div class="post-detail-layout"><div class="post-detail-media"></div><aside><div class="post-detail-heading"><img class="post-author-avatar" alt=""><div><div class="post-author-name"></div><p class="post-detail-caption"></p></div></div><div class="post-detail-actions"><button type="button" data-like aria-label="Like post"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg><span data-like-count>0</span></button><button type="button" data-focus-comment aria-label="View comments"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg><span data-comment-count>0</span></button><button type="button" data-save aria-label="Save post"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h12v16l-6-4-6 4z"/></svg></button></div><div class="post-comments"></div><form class="post-comment-form"><input maxlength="1000" placeholder="Write a comment…" required><button class="btn primary">Send</button></form></aside></div></section>';
      document.body.append(modal); modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-close]'))modal.style.display='none';});
    }
    modal.dataset.postId=post.id;
    modal.querySelector('.post-detail-media').replaceChildren();
    if(mediaUrl){const media=post.media_type==='video'?document.createElement('video'):document.createElement('img');media.src=mediaUrl;if(media.tagName==='VIDEO')media.controls=true;media.alt='Post media';modal.querySelector('.post-detail-media').append(media);}
    const caption=modal.querySelector('.post-detail-caption');caption.textContent=post.caption||'';
    const authorAvatar=modal.querySelector('.post-author-avatar'),authorName=modal.querySelector('.post-author-name');
    const {data:author}=await db.from('profiles').select('id,username,display_name,avatar_path').eq('id',post.owner_id).maybeSingle();
    authorName.textContent=author?.display_name||author?.username||'User';
    authorAvatar.src=author?.avatar_path?db.storage.from('surf-profile-assets').getPublicUrl(author.avatar_path).data.publicUrl:'';
    authorAvatar.style.display=authorAvatar.src?'block':'none';
    const likeBtn=modal.querySelector('[data-like]'),commentsBox=modal.querySelector('.post-comments'),form=modal.querySelector('.post-comment-form');
    const blockedTerms=['fuck','fucking','motherfucker','shit','bullshit','bitch','bastard','asshole','dickhead','cunt','piss off','slut','whore','retard','kys'];
    function censor(text){if(localStorage.getItem('surfPref_commentFilter')==='false')return text;let result=text;for(const term of blockedTerms){const re=new RegExp('\\b'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi');result=result.replace(re,'*'.repeat(Math.min(term.length,8)));}return result;}
    async function refreshPostSocial(){
      const [{count:likes},{data:mine},{data:comments,error}]=await Promise.all([
        db.from('post_likes').select('post_id',{count:'exact',head:true}).eq('post_id',post.id),
        db.from('post_likes').select('post_id').eq('post_id',post.id).eq('user_id',window.surfCurrentUserId).maybeSingle(),
        db.from('post_comments').select('id,user_id,body,created_at,parent_comment_id').eq('post_id',post.id).order('created_at')
      ]);
      if(error){commentsBox.textContent='Comments unavailable. Apply the updated post-interactions SQL migration.';return;}
      likeBtn.querySelector('[data-like-count]').textContent=likes||0;likeBtn.dataset.liked=mine?'1':'0';likeBtn.classList.toggle('liked',!!mine);modal.querySelector('[data-comment-count]').textContent=(comments||[]).length;commentsBox.replaceChildren();
      const ids=[...new Set([...(comments||[]).map(c=>c.user_id),post.owner_id])];let profiles=[];if(ids.length){const r=await db.from('profiles').select('id,username,display_name,avatar_path').in('id',ids);profiles=r.data||[];}
      const byId=new Map(profiles.map(p=>[p.id,p]));const own=window.surfCurrentUserId;
      const renderComment=(c,depth=0)=>{const p=byId.get(c.user_id),row=document.createElement('div');row.className='post-comment';row.style.marginLeft=depth?'24px':'0';const avatar=document.createElement('img');avatar.className='post-comment-avatar';avatar.alt='';if(p?.avatar_path)avatar.src=db.storage.from('surf-profile-assets').getPublicUrl(p.avatar_path).data.publicUrl;const body=document.createElement('div');body.className='post-comment-body';const username=document.createElement('strong');username.textContent=p?.display_name||p?.username||'User';const text=document.createElement('p');text.textContent=censor(c.body);body.append(username,text);const tools=document.createElement('div');tools.className='post-comment-tools';const reply=document.createElement('button');reply.type='button';reply.textContent='Reply';reply.onclick=()=>{let replyForm=row.querySelector('.post-comment-reply');if(replyForm){replyForm.remove();return;}replyForm=document.createElement('form');replyForm.className='post-comment-reply';const input=document.createElement('input');input.maxLength=1000;input.placeholder='Write a reply…';input.required=true;const send=document.createElement('button');send.className='btn primary';send.textContent='Reply';replyForm.append(input,send);replyForm.onsubmit=async e=>{e.preventDefault();const bodyText=input.value.trim();if(!bodyText)return;const payload={post_id:post.id,user_id:own,body:censor(bodyText),parent_comment_id:c.id};const r=await db.from('post_comments').insert(payload);if(r.error)return safeError(r.error,'Could not reply. Run the updated post-interactions migration first.');await refreshPostSocial();};body.append(replyForm);input.focus();};tools.append(reply);
        if(c.user_id===own||post.owner_id===own){const del=document.createElement('button');del.type='button';del.textContent='Delete';del.onclick=async()=>{if(!confirm('Delete this comment?'))return;const r=await db.from('post_comments').delete().eq('id',c.id);if(r.error)return safeError(r.error,'Could not delete comment. Apply the updated SQL migration.');await refreshPostSocial();};tools.append(del);}body.append(tools);row.append(avatar,body);commentsBox.append(row);};
      const roots=(comments||[]).filter(c=>!c.parent_comment_id),children=(comments||[]).filter(c=>c.parent_comment_id);roots.forEach(c=>{renderComment(c);children.filter(r=>r.parent_comment_id===c.id).forEach(r=>renderComment(r,1));});
    }
    likeBtn.onclick=async()=>{const liked=likeBtn.dataset.liked==='1';const result=liked?await db.from('post_likes').delete().eq('post_id',post.id).eq('user_id',window.surfCurrentUserId):await db.from('post_likes').insert({post_id:post.id,user_id:window.surfCurrentUserId});if(result.error)return safeError(result.error,'Could not update like. Apply post-interactions SQL migration.');await refreshPostSocial();};
    modal.querySelector('[data-focus-comment]').onclick=()=>form.querySelector('input').focus();
    const saveBtn=modal.querySelector('[data-save]');const savedCheck=await db.from('saved_posts').select('post_id').eq('post_id',post.id).eq('user_id',window.surfCurrentUserId).maybeSingle();if(!savedCheck.error)saveBtn.classList.toggle('saved',!!savedCheck.data);saveBtn.onclick=async()=>{const r=await db.from('saved_posts').select('post_id').eq('post_id',post.id).eq('user_id',window.surfCurrentUserId).maybeSingle();if(r.error)return safeError(r.error,'Could not check saved post.');const x=r.data?await db.from('saved_posts').delete().eq('post_id',post.id).eq('user_id',window.surfCurrentUserId):await db.from('saved_posts').insert({post_id:post.id,user_id:window.surfCurrentUserId});if(x.error)return safeError(x.error,'Could not save post.');saveBtn.classList.toggle('saved',!r.data);toast(r.data?'Post unsaved':'Post saved');};
    form.onsubmit=async e=>{e.preventDefault();const input=form.querySelector('input'),body=input.value.trim();if(!body)return;const result=await db.from('post_comments').insert({post_id:post.id,user_id:window.surfCurrentUserId,body:censor(body)});if(result.error)return safeError(result.error,'Could not post comment. Apply the updated post-interactions SQL migration.');input.value='';await refreshPostSocial();};
    await refreshPostSocial();modal.style.zIndex='10020';modal.style.display='grid';
  }

  async function openFollowList(kind, ownerId = window.surfCurrentUserId) {
    const column=kind==='followers'?'follower_id':'followed_id';
    const {data,error}=await db.from('surf_follows').select('follower_id,followed_id').eq(kind==='followers'?'followed_id':'follower_id',ownerId);
    if(error)return safeError(error,'Could not load '+kind+'.');
    const ids=(data||[]).map(row=>kind==='followers'?row.follower_id:row.followed_id); if(!ids.length){toast('No '+kind+' yet.');return;}
    const result=await db.from('profiles').select('username,display_name').in('id',ids);if(result.error)return safeError(result.error,'Could not load profiles.');
    const names=(result.data||[]).map(p=>p.display_name||p.username); alert((kind==='followers'?'Followers':'Following')+'\n\n'+names.join('\n'));
  }

  async function openSavedPosts() {
    openModal('savedPostsModal'); const list = document.getElementById('savedPostsList'); list.replaceChildren();
    const { data, error } = await db.from('saved_posts').select('post_id').eq('user_id', window.surfCurrentUserId).order('created_at', { ascending: false });
    if (error) return safeError(error, 'Could not load saved posts.');
    const ids = (data || []).map((item) => item.post_id); if (!ids.length) return setEmpty(list, 'Posts you save will appear here.');
    const { data: posts, error: postError } = await db.from('posts').select('*').in('id', ids);
    if (postError) return safeError(postError, 'Could not load saved posts.');
    list.className = 'saved-post-grid';
    for (const post of posts || []) { const { data: signed } = await db.storage.from('surf-post-media').createSignedUrl(post.media_path, 3600); if (!signed?.signedUrl) continue; const card = document.createElement('article'); card.className = 'grid-post surf-post-card'; if (post.media_type === 'video') { const video = document.createElement('video'); video.src = signed.signedUrl; video.controls = true; card.append(video); } else { const image = document.createElement('img'); image.src = signed.signedUrl; card.append(image); } const caption = document.createElement('p'); caption.textContent = post.caption; card.append(caption); list.append(card); }
  }

  function animateStoryLike(person) {
    const floater = document.createElement('div'); floater.className = 'story-like-float';
    const url = profileAssetUrl(person?.avatar_path);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; floater.append(img); }
    else { const initialsNode = document.createElement('b'); initialsNode.textContent = initials(person || {}); floater.append(initialsNode); }
    document.querySelector('.story-viewer')?.append(floater); setTimeout(() => floater.remove(), 1500);
  }

  async function toggleStoryLike() {
    const story = activeStoryCollection?.[activeStoryIndex];
    if (!story || !window.surfCurrentUserId) return;
    if (likedStoryIds.has(story.id)) {
      const { error } = await db.from('story_likes').delete().eq('story_id', story.id).eq('user_id', window.surfCurrentUserId);
      if (error) return safeError(error, 'Could not remove your story like.');
      likedStoryIds.delete(story.id);
    } else {
      const { error } = await db.from('story_likes').upsert({ story_id: story.id, user_id: window.surfCurrentUserId }, { onConflict: 'story_id,user_id', ignoreDuplicates: true });
      if (error) return safeError(error, 'Could not like this story.');
      likedStoryIds.add(story.id); animateStoryLike(selfProfile);
    }
    renderLiveStoryViewer(); scheduleNotificationRefresh();
  }

  async function addStoryHighlight() {
    const story = activeStoryCollection?.[activeStoryIndex];
    if (!story || activeStoryProfile?.id !== window.surfCurrentUserId) return;
    const title = (prompt('Name this highlight:', 'Highlights') || '').trim();
    if (!title) return;
    const { error } = await db.from('story_highlights').insert({ owner_id: window.surfCurrentUserId, story_id: story.id, title });
    if (error) return safeError(error, 'Could not add this story to highlights.');
    await loadStoryHighlights(); toast('Added to highlights.');
  }

  async function loadStoryHighlights() {
    const list = document.getElementById('storyHighlightsList'); if (!list) return;
    const { data: saved, error } = await db.from('story_highlights').select('id,owner_id,story_id,title,created_at').order('created_at', { ascending: true });
    if (error) throw error;
    const ids = [...new Set((saved || []).map((item) => item.story_id))];
    if (!ids.length) { highlightSets = []; list.innerHTML = '<p class="friends-empty">Your saved story highlights will appear here.</p>'; return; }
    const [{ data: stories, error: storiesError }, { data: profiles, error: profilesError }] = await Promise.all([
      db.from('stories').select('*').in('id', ids).order('created_at', { ascending: true }),
      db.from('profiles').select('id,username,display_name,avatar_path').in('id', [...new Set(saved.map((item) => item.owner_id))])
    ]);
    if (storiesError) throw storiesError; if (profilesError) throw profilesError;
    const storyById = new Map((stories || []).map((story) => [story.id, story]));
    const profileById = new Map((profiles || []).map((person) => [person.id, person]));
    const groups = new Map();
    for (const item of saved) {
      const story = storyById.get(item.story_id), owner = profileById.get(item.owner_id); if (!story || !owner) continue;
      if (!groups.has(item.owner_id + ':' + item.title)) groups.set(item.owner_id + ':' + item.title, { owner, title: item.title, items: [], isYours: item.owner_id === window.surfCurrentUserId });
      if (story.media_path) {
        const { data: signed, error: signedError } = await db.storage.from('surf-stories').createSignedUrl(story.media_path, 3600);
        if (!signedError) story.url = signed.signedUrl;
      }
      groups.get(item.owner_id + ':' + item.title).items.push(story);
    }
    highlightSets = [...groups.values()]; list.replaceChildren();
    highlightSets.forEach((entry) => {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'story-highlight-card';
      const first = entry.items[0];
      if (first?.url) { const img = document.createElement('img'); img.src = first.url; img.alt = ''; card.append(img); }
      else if (first?.background_color) card.style.background = first.background_color;
      const label = document.createElement('span'); label.textContent = entry.title; card.append(label);
      card.onclick = () => openLiveStory({ ...entry, owner: entry.owner }); list.append(card);
    });
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
      await loadStories(); closeModal('storyModal'); activeStoryCollection = yourStories; activeStoryOwner = 'Your story'; activeStoryProfile = selfProfile; activeStoryEmoji = initials(selfProfile || {}); activeStoryIndex = 0; activeStoryViewId = null;
      renderStoryViewer(); openModal('storyViewer'); toast('Uploaded!', 1000);
    } catch (error) { safeError(error, 'Story upload failed. Check storage setup and try again.'); }
  }

  function renderAllLiveStories() {
    const grid = document.getElementById('allStoriesGrid'); if (!grid) return;
    grid.innerHTML = '';
    const entries = [{ owner: selfProfile || { username: document.querySelector('.profile-handle')?.textContent.replace(/^@/, '') || 'you', display_name: 'Your story' }, items: yourStories, isYours: true }, ...storySets];
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

  async function loadProfileCardCounts(ownerId) {
    const nodes = ['profileCardPosts', 'profileCardFollowers', 'profileCardFollowing'].map((id) => document.getElementById(id));
    const [posts, followers, following] = await Promise.all([
      db.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
      db.from('surf_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', ownerId),
      db.from('surf_follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', ownerId)
    ]);
    if (activeProfile?.id !== ownerId) return;
    const errors = [posts.error, followers.error, following.error].filter(Boolean);
    if (errors.length) {
      errors.forEach((error) => console.error('Chat profile count query failed:', error));
      nodes.forEach((node) => { if (node) node.textContent = '—'; });
      return;
    }
    [posts.count, followers.count, following.count].forEach((count, index) => { if (nodes[index]) nodes[index].textContent = String(count ?? 0); });
  }

  async function openProfileForCurrentChat() {
    const id = window.surfActiveRecipientId; const person = friends.find((item) => item.id === id);
    if (!person) return;
    activeProfile = person;
    document.getElementById('profileCardName').textContent = person.display_name || person.username;
    document.getElementById('profileCardHandle').textContent = '@' + person.username + ' · ' + statusLabel(person.status).toLowerCase();
    document.getElementById('profileCardBio').textContent = person.bio || 'No bio yet.';
    const ageBadge = document.getElementById('profileCardAgeBadge'); if (ageBadge) { ageBadge.textContent = person.is_minor ? '🧒 Minor' : '18+'; ageBadge.style.display = 'inline-flex'; }
    renderSocialLinks(document.getElementById('profileCardSocialLinks'), person.social_links);
    const cardAvatarUrl = profileAssetUrl(person.avatar_path);
    const cardAvatar = document.getElementById('profileCardAvatar');
    cardAvatar.textContent = cardAvatarUrl ? '' : initials(person);
    cardAvatar.style.backgroundImage = cardAvatarUrl ? `url("${cardAvatarUrl}")` : '';
    cardAvatar.style.backgroundSize = 'cover'; cardAvatar.style.backgroundPosition = 'center';
    const cardBanner = document.getElementById('profileCardBanner');
    cardBanner.style.backgroundImage = person.banner_path ? `url("${profileAssetUrl(person.banner_path)}")` : '';
    cardBanner.style.backgroundSize = 'cover'; cardBanner.style.backgroundPosition = 'center';
    document.getElementById('profileCardPosts').textContent = '…'; document.getElementById('profileCardFollowers').textContent = '…'; document.getElementById('profileCardFollowing').textContent = '…';
    loadProfileCardCounts(person.id);
    document.getElementById('profileCardFollowers').parentElement.style.cursor='pointer'; document.getElementById('profileCardFollowers').parentElement.onclick=()=>openFollowList('followers',person.id); document.getElementById('profileCardFollowing').parentElement.style.cursor='pointer'; document.getElementById('profileCardFollowing').parentElement.onclick=()=>openFollowList('following',person.id);
    const rel = person.relation;
    document.getElementById('blockPersonButton').textContent = 'Block'; document.getElementById('mutePersonButton').textContent = 'Mute';
    document.getElementById('relationshipPersonButton').textContent = rel.requester_id === window.surfCurrentUserId ? 'Unfriend' : 'Unfriend';
    openModal('profileModal');
  }

  async function updateOwnCounts() {
    const id = window.surfCurrentUserId;
    if (!id) return;
    const [postCount, followersCount, followingCount] = await Promise.all([
      db.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', id),
      db.from('surf_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', id),
      db.from('surf_follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', id)
    ]);
    const errors = [postCount.error, followersCount.error, followingCount.error].filter(Boolean);
    if (errors.length) { errors.forEach((error) => console.error('Own profile count query failed:', error)); return; }
    const counts = [postCount.count ?? 0, followersCount.count ?? 0, followingCount.count ?? 0];
    // Only update the side-profile stats (the signed-in user's own profile).
    const ownStats = document.querySelectorAll('.right .stats b');
    ownStats.forEach((item, index) => { if (counts[index] !== undefined) item.textContent = String(counts[index]); });
    // Never overwrite another person's full-profile counts with the current user's counts.
    const profilePage = document.getElementById('profilePage');
    if (profilePage?.dataset.ownerId === id) {
      const profileValues = profilePage.querySelectorAll('.profile-stats b');
      profileValues.forEach((item, index) => { if (counts[index] !== undefined) item.textContent = String(counts[index]); });
    }
  }

  let currentProfileOwnerId = null;
  window.switchProfileTab = function(tab, button) {
    document.querySelectorAll('.profile-tab').forEach((item) => item.classList.toggle('active', item === button));
    const grid = document.getElementById('profileGrid');
    const view = tab === 'reels' ? 'videos' : tab;
    if (grid) grid.dataset.view = view;
    if (currentProfileOwnerId) loadProfilePosts(currentProfileOwnerId, grid, view);
  };

  async function saveLiveProfile() {
    const displayName = document.getElementById('editUsername').value.trim();
    const username = document.getElementById('editHandle').value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 24);
    const bio = document.getElementById('editBio').value.trim().slice(0, 300);
    if (username.length < 3) return toast('Username needs at least 3 characters.');
    const { data: saved, error } = await db.from('profiles').update({ display_name: displayName || username, username, bio, updated_at: new Date().toISOString() }).eq('id', window.surfCurrentUserId).select('id').maybeSingle();
    if (error) return safeError(error, 'Could not save your profile.');
    if (!saved) return toast('Your profile could not be found. Sign out and sign back in, then try again.');
    const ownSideName = document.querySelector('.right .profile-name');
    const ownSideHandle = document.querySelector('.right .profile-handle');
    const ownSideBio = document.querySelector('.right .bio');
    if (ownSideName) ownSideName.textContent = displayName || username;
    if (ownSideHandle) ownSideHandle.textContent = '@' + username;
    if (ownSideBio) ownSideBio.textContent = bio;
    document.getElementById('myProfileMenuName').textContent = displayName || username;
    document.getElementById('myProfileMenuHandle').textContent = '@' + username;
    selfProfile = { ...selfProfile, username: displayName || username, handle: username, bio };
    if (currentProfileOwnerId === window.surfCurrentUserId) {
      document.getElementById('pageName').textContent = selfProfile.username;
      document.getElementById('pageHandle').textContent = username;
      document.getElementById('pageBio').textContent = bio;
    }
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
    const { error: ownerError } = await db.from('group_members').upsert(
      { group_id: group.id, user_id: window.surfCurrentUserId, role: 'owner' },
      { onConflict: 'group_id,user_id', ignoreDuplicates: true }
    );
    if (ownerError) return safeError(ownerError, 'Group created but membership could not be saved. Run the latest schema migration, then reload.');
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

  async function openGroupDetails(group = window.surfActiveGroup) {
    if (!group?.id) return toast('Choose a group first.');
    window.surfActiveGroup = group;
    const detailsModal = document.getElementById('groupDetailsModal');
    if (detailsModal) { detailsModal.style.zIndex = '10010'; detailsModal.style.display = 'grid'; }
    const memberListLoading = document.getElementById('groupDetailsMembers');
    if (memberListLoading) memberListLoading.innerHTML = '<p class="friends-empty">Loading group members…</p>';
    const { data: selfMembership } = await db.from('group_members').select('role').eq('group_id', group.id).eq('user_id', window.surfCurrentUserId).maybeSingle();
    group.my_role = selfMembership?.role || (group.owner_id === window.surfCurrentUserId ? 'owner' : 'member');
    const isAdmin = group.my_role === 'admin' || group.my_role === 'owner' || group.owner_id === window.surfCurrentUserId;
    document.getElementById('groupDetailsName').textContent = group.name;
    document.getElementById('groupDetailsCreated').textContent = new Date(group.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('groupDetailsBio').textContent = group.bio || 'No group bio yet.';
    const avatar = document.getElementById('groupDetailsAvatar');
    avatar.textContent = group.avatar_path ? '' : group.name.slice(0, 1).toUpperCase();
    avatar.style.backgroundImage = group.avatar_path ? `url("${db.storage.from('surf-group-assets').getPublicUrl(group.avatar_path).data.publicUrl}")` : '';
    document.getElementById('groupAdminTools').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('groupDetailsEditName').value = group.name;
    document.getElementById('groupDetailsEditBio').value = group.bio || '';
    document.getElementById('groupDeleteButton').style.display = isAdmin ? '' : 'none';
    document.getElementById('groupLeaveButton').style.display = group.owner_id === window.surfCurrentUserId ? 'none' : '';
    const list = document.getElementById('groupDetailsMembers'); list.replaceChildren();
    const { data: memberships, error: membershipError } = await db.from('group_members').select('user_id,role,added_at').eq('group_id', group.id);
    if (membershipError) return safeError(membershipError, 'Could not load group members.');
    const memberIds = [...new Set((memberships || []).map((m) => m.user_id))];
    let profiles = [];
    if (memberIds.length) {
      const { data, error } = await db.from('profiles').select('id,username,display_name,avatar_path').in('id', memberIds);
      if (error) return safeError(error, 'Could not load member profiles.');
      profiles = data || [];
    }
    document.getElementById('groupDetailsMemberCount').textContent = `${profiles.length} member${profiles.length === 1 ? '' : 's'}`;
    memberships?.forEach((membership) => {
      const person = profiles.find((p) => p.id === membership.user_id) || { id: membership.user_id, username: 'Member' };
      const row = document.createElement('div'); row.className = 'group-details-member';
      row.append(avatarNode(person, 'friend-list-avatar'));
      const label = document.createElement('span'); label.textContent = person.display_name || person.username; row.append(label);
      const role = document.createElement('small'); role.textContent = membership.role === 'owner' ? 'Owner' : membership.role === 'admin' ? 'Admin' : 'Member'; row.append(role);
      if (isAdmin && membership.user_id !== window.surfCurrentUserId && membership.role !== 'owner') {
        const admin = document.createElement('button'); admin.type = 'button'; admin.textContent = membership.role === 'admin' ? 'Remove admin' : 'Make admin';
        admin.onclick = () => updateGroupMemberRole(group, membership.user_id, membership.role === 'admin' ? 'member' : 'admin'); row.append(admin);
        const kick = document.createElement('button'); kick.type = 'button'; kick.className = 'danger-option'; kick.textContent = 'Remove'; kick.onclick = () => removeGroupMember(group, membership.user_id); row.append(kick);
      }
      list.append(row);
    });
    if (detailsModal) detailsModal.style.zIndex = '10010';
    openModal('groupDetailsModal');
  }

  async function saveGroupDetails() {
    const group = window.surfActiveGroup; if (!group) return;
    const name = document.getElementById('groupDetailsEditName').value.trim().slice(0, 80);
    const bio = document.getElementById('groupDetailsEditBio').value.trim().slice(0, 300);
    if (!name) return toast('Group name cannot be empty.');
    const { error } = await db.from('group_conversations').update({ name, bio }).eq('id', group.id);
    if (error) return safeError(error, 'Could not update group details. Apply the group management migration, then try again.');
    Object.assign(group, { name, bio });
    document.getElementById('workspaceName').textContent = name;
    document.getElementById('chatName').textContent = name;
    document.getElementById('groupDetailsName').textContent = name;
    const rowName = document.querySelector(`#chatList [data-group-id="${group.id}"] .person-name`);
    if (rowName) rowName.textContent = name;
    toast('Group details saved.');
  }

  async function updateGroupMemberRole(group, userId, role) {
    const { error } = await db.from('group_members').update({ role }).eq('group_id', group.id).eq('user_id', userId);
    if (error) return safeError(error, 'Could not update this member role. Apply the group management migration, then try again.');
    openGroupDetails(group);
  }
  async function removeGroupMember(group, userId) {
    if (!confirm('Remove this member from the group?')) return;
    const { error } = await db.from('group_members').delete().eq('group_id', group.id).eq('user_id', userId);
    if (error) return safeError(error, 'Could not remove this member. Apply the group management migration, then try again.');
    openGroupDetails(group);
  }
  async function leaveLiveGroup() {
    const group = window.surfActiveGroup; if (!group) return;
    const { error } = await db.from('group_members').delete().eq('group_id', group.id).eq('user_id', window.surfCurrentUserId);
    if (error) return safeError(error, 'Could not leave this group.');
    closeModal('groupDetailsModal'); window.surfActiveGroupId = null; window.surfActiveGroup = null;
    await loadLiveSurfWorkspace(); toast('You left the group.');
  }
  async function deleteLiveGroup() {
    const group = window.surfActiveGroup; if (!group) return;
    if (!confirm(`Delete “${group.name}” and its messages for everyone?`)) return;
    const { error } = await db.from('group_conversations').delete().eq('id', group.id);
    if (error) return safeError(error, 'Could not delete this group.');
    closeModal('groupDetailsModal'); window.surfActiveGroupId = null; window.surfActiveGroup = null;
    await loadLiveSurfWorkspace(); toast('Group deleted.');
  }
  async function uploadGroupAvatar(input) {
    const group = window.surfActiveGroup, file = input?.files?.[0]; if (!group || !file) return;
    if (!file.type.startsWith('image/')) return toast('Choose an image file.');
    const path = `${group.id}/${window.surfCurrentUserId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const { error: uploadError } = await db.storage.from('surf-group-assets').upload(path, file, { upsert: true });
    if (uploadError) return safeError(uploadError, 'Could not upload the group picture. Apply the group management migration first.');
    const { error } = await db.from('group_conversations').update({ avatar_path: path }).eq('id', group.id);
    if (error) return safeError(error, 'Picture uploaded, but the group could not be updated.');
    group.avatar_path = path; const avatar = document.getElementById('groupDetailsAvatar');
    avatar.style.backgroundImage = `url("${db.storage.from('surf-group-assets').getPublicUrl(path).data.publicUrl}")`; avatar.textContent = ''; toast('Group picture updated.');
  }

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
    let path = '';
    try {
      const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      path = `${window.surfCurrentUserId}/${kind}-${Date.now()}.${extension}`;
      const { error: uploadError } = await db.storage.from('surf-profile-assets').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const column = kind === 'avatar' ? 'avatar_path' : 'banner_path';
      const previous = selfProfile?.[column];
      const { data: saved, error: saveError } = await db.from('profiles').update({ [column]: path, updated_at: new Date().toISOString() }).eq('id', window.surfCurrentUserId).select('id').maybeSingle();
      if (saveError) throw saveError;
      if (!saved) throw new Error('Your profile row was not found. Sign out and sign back in, then try again.');
      selfProfile = { ...selfProfile, [column]: path };
      const crop = pendingCropData;
      if (crop) localStorage.setItem(`surf-profile-crop:${window.surfCurrentUserId}:${kind}`, JSON.stringify(crop));
      applyProfileAssets(selfProfile);
      document.querySelectorAll('[data-self-avatar], #railSelfAvatar, #yourStoryAvatar').forEach((node) => { if (kind === 'avatar') { node.style.backgroundImage = `url("${profileAssetUrl(path)}")`; node.style.backgroundSize = 'cover'; node.style.backgroundPosition = 'center'; node.textContent = ''; } });
      if (previous && previous !== path) await db.storage.from('surf-profile-assets').remove([previous]);
      toast(kind === 'avatar' ? 'Profile picture saved.' : 'Profile banner saved.');
    } catch (error) {
      if (path) await db.storage.from('surf-profile-assets').remove([path]).catch(() => {});
      console.error('Surf profile image save failed:', error);
      const message = error?.message || 'Upload failed. Run supabase/profile-assets.sql, then try again.';
      toast(/bucket not found|row-level security/i.test(message) ? 'Profile image storage is not ready. Run profile-assets.sql in Supabase, then upload again.' : message);
    } finally {
      const input = document.getElementById(kind === 'avatar' ? 'pfpInput' : 'bannerInput');
      if (input) input.value = '';
    }
  }

  function bindProfileImageUploads() {
    const avatarInput = document.getElementById('pfpInput');
    const bannerInput = document.getElementById('bannerInput');
    if (avatarInput && !avatarInput.dataset.liveUploadBound) {
      avatarInput.dataset.liveUploadBound = '1';
      avatarInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        pendingProfileImage = file ? { file, kind: 'avatar' } : null;
      }, true);
    }
    if (bannerInput && !bannerInput.dataset.liveUploadBound) {
      bannerInput.dataset.liveUploadBound = '1';
      bannerInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        pendingProfileImage = file ? { file, kind: 'banner' } : null;
      }, true);
    }

    // Use explicit picker handlers so the profile controls work even when nested in overlays.
    window.openProfileAssetPicker = function(kind) {
      if (!window.surfCurrentUserId) return toast('Please sign in before changing your profile image.');
      const input = document.getElementById(kind === 'avatar' ? 'pfpInput' : 'bannerInput');
      if (!input) return toast('The image picker is unavailable. Refresh the page and try again.');
      input.value = '';
      input.click();
    };

    // Do not replace window.saveCrop: keep the cropper's original global function intact.
    window.saveProfileCropAndUpload = async function() {
      const pending = pendingProfileImage;
      if (!pending) {
        toast('Choose an image first, then save the crop.');
        return;
      }
      if (!window.surfCurrentUserId) {
        toast('Please sign in again before saving your profile image.');
        return;
      }
      let task = null;
      try { if (typeof cropTask !== 'undefined') task = cropTask; } catch { /* Crop state is not available. */ }
      if (!task || !task.box || !task.bounds) {
        toast('Wait for the image crop to load, then try again.');
        return;
      }
      try {
        // The original cropper calculates task.source and closes the modal.
        window.saveCrop();
        if (task.source) pendingCropData = { x: task.source.x, y: task.source.y, width: task.source.w, height: task.source.h, sourceWidth: task.naturalWidth, sourceHeight: task.naturalHeight };
        await persistProfileImage(pending.file, pending.kind);
      } catch (error) {
        console.error('Profile crop/save failed:', error);
        toast(error?.message || 'Could not save the profile image.');
      } finally {
        pendingProfileImage = null;
        pendingCropData = null;
      }
    };
    const cancel = window.cancelCrop;
    window.cancelCrop = function() {
      pendingProfileImage = null;
      if (typeof cancel === 'function') cancel();
    };
  }

  function enterAppWithLiveData() {
    const original = window.enterApp;
    window.enterApp = function(user) {
      original(user);
      if (user?.id) {
        selfProfile = user;
        window.surfCurrentUserId = user.id;
        renderSocialAccountSettings();
        removeSeedContent();
        applyProfileAssets(user);
        document.getElementById('pageName').textContent = user.username || 'Your profile';
        document.getElementById('pageHandle').textContent = user.handle || '';
        document.getElementById('pageBio').textContent = user.bio || '';
        loadLiveSurfWorkspace();
      }
      else { window.surfCurrentUserId = null; window.surfActiveRecipientId = null; window.surfActiveGroupId = null; }
    };
    const originalShowProfilePage = window.showProfilePage;
    window.showProfilePage = function() {
      originalShowProfilePage();
      const person = activeProfile || selfProfile;
      currentProfileOwnerId = person?.id || null;
      const profilePage = document.getElementById('profilePage');
      if (profilePage) profilePage.dataset.ownerId = person?.id || '';
      document.getElementById('pageName').textContent = person?.display_name || person?.username || 'Profile';
      document.getElementById('pageHandle').textContent = person?.username || '';
      document.getElementById('pageBio').textContent = person?.bio || 'No bio yet.';
      const isOwnProfile = !!person?.id && person.id === window.surfCurrentUserId;
      const editBioButton = document.getElementById('editOwnBioButton');
      const followButton = document.getElementById('pageFollowButton');
      const addHighlightButton = document.querySelector('#profileHighlightRow .profile-highlight-add');
      if (editBioButton) editBioButton.style.display = isOwnProfile ? 'inline-flex' : 'none';
      if (followButton) followButton.style.display = isOwnProfile ? 'none' : 'inline-flex';
      if (person?.id && !isOwnProfile) refreshPageFollowState(person);
      else { pageFollowState = { personId: person?.id || null, iFollow: false, followsMe: false, busy: false }; if (followButton) followButton.style.display = 'none'; }
      // Only the owner of the currently viewed profile can add/manage highlights.
      if (addHighlightButton) addHighlightButton.style.display = isOwnProfile ? 'grid' : 'none';
      if (person?.id) loadProfilePosts(person.id);
      if (person?.id && person.id !== window.surfCurrentUserId) loadProfileCounts(person.id);
      const pageAvatar = document.getElementById('pageAvatar');
      const avatarUrl = profileAssetUrl(person?.avatar_path);
      if (pageAvatar) {
        pageAvatar.textContent = avatarUrl ? '' : initials(person || {});
        pageAvatar.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
        pageAvatar.style.backgroundSize = 'cover';
        pageAvatar.style.backgroundPosition = 'center';
      }
      const bannerUrl = profileAssetUrl(person?.banner_path);
      if (bannerUrl) {
        document.documentElement.style.setProperty('--profile-banner', `url("${bannerUrl}")`);
        document.documentElement.style.setProperty('--banner-size', 'cover');
        document.documentElement.style.setProperty('--banner-position', 'center');
      } else {
        document.documentElement.style.removeProperty('--profile-banner');
        document.documentElement.style.removeProperty('--banner-size');
        document.documentElement.style.removeProperty('--banner-position');
      }
      const badge = document.getElementById('pageAgeBadge');
      if (badge && person) { badge.textContent = person.is_minor ? '🧒 Minor' : '18+'; badge.style.display = 'inline-flex'; }
      renderSocialLinks(document.getElementById('pageSocialLinks'), person?.social_links);
    };
    window.showMyProfile = function() {
      if (!selfProfile) return;
      currentProfileOwnerId = selfProfile.id;
      const profilePage = document.getElementById('profilePage');
      if (profilePage) profilePage.dataset.ownerId = selfProfile.id;
      const editBioButton = document.getElementById('editOwnBioButton');
      const followButton = document.getElementById('pageFollowButton');
      const addHighlightButton = document.querySelector('#profileHighlightRow .profile-highlight-add');
      if (editBioButton) editBioButton.style.display = 'inline-flex';
      if (followButton) followButton.style.display = 'none';
      if (addHighlightButton) addHighlightButton.style.display = 'grid';
      document.documentElement.style.removeProperty('--profile-banner');
      document.documentElement.style.removeProperty('--banner-size');
      document.documentElement.style.removeProperty('--banner-position');
      document.getElementById('pageName').textContent = selfProfile.username || 'Your profile';
      document.getElementById('pageHandle').textContent = selfProfile.handle || '';
      document.getElementById('pageBio').textContent = selfProfile.bio || '';
      document.querySelectorAll('.profile-tab').forEach((item, index) => item.classList.toggle('active', index === 0));
      const profileGrid = document.getElementById('profileGrid');
      if (profileGrid) profileGrid.dataset.view = 'posts';
      document.getElementById('profilePage').style.display = 'block';
      applyProfileAssets(selfProfile);
      loadProfilePosts(selfProfile.id);
      updateOwnCounts();
      const age = document.getElementById('pageAgeBadge');
      if (age) { age.textContent = selfProfile.is_minor ? '🧒 Minor' : '18+'; age.style.display = 'inline-flex'; }
      renderSocialLinks(document.getElementById('pageSocialLinks'), selfProfile.social_links);
    };
    window.saveStoryHighlight = saveStoryHighlight;
    window.openGroupDetails = openGroupDetails;
    window.saveGroupDetails = saveGroupDetails;
    window.updateGroupMemberRole = updateGroupMemberRole;
    window.removeGroupMember = removeGroupMember;
    window.leaveLiveGroup = leaveLiveGroup;
    window.deleteLiveGroup = deleteLiveGroup;
    window.uploadGroupAvatar = uploadGroupAvatar;
    window.openGroupDetails = openGroupDetails;
  }

  async function loadProfileCounts(ownerId) {
    const page = document.getElementById('profilePage');
    if (!page || !ownerId) return;
    const values = page.querySelectorAll('.profile-stats b');
    values.forEach((node) => { node.textContent = '…'; });
    const [postCount, followersCount, followingCount] = await Promise.all([
      db.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId),
      db.from('surf_follows').select('follower_id', { count: 'exact', head: true }).eq('followed_id', ownerId),
      db.from('surf_follows').select('followed_id', { count: 'exact', head: true }).eq('follower_id', ownerId)
    ]);
    // The user may have opened another profile while the count requests were in flight.
    if (page.dataset.ownerId !== ownerId) return;
    const errors = [postCount.error, followersCount.error, followingCount.error].filter(Boolean);
    if (errors.length) {
      errors.forEach((error) => console.error('Profile count query failed:', error));
      values.forEach((node) => { node.textContent = '—'; });
      return;
    }
    [postCount.count, followersCount.count, followingCount.count].forEach((count, index) => {
      if (values[index]) values[index].textContent = String(count ?? 0);
    });
  }

  async function refreshPageFollowState(person) {
    const button = document.getElementById('pageFollowButton');
    if (!button || !person?.id || !window.surfCurrentUserId || person.id === window.surfCurrentUserId) {
      if (button) button.style.display = 'none';
      pageFollowState = { personId: person?.id || null, iFollow: false, followsMe: false, busy: false };
      return;
    }
    pageFollowState = { personId: person.id, iFollow: false, followsMe: false, busy: false };
    button.style.display = 'inline-flex';
    button.disabled = true;
    button.textContent = '…';
    const [outgoing, incoming] = await Promise.all([
      db.from('surf_follows').select('follower_id').eq('follower_id', window.surfCurrentUserId).eq('followed_id', person.id).maybeSingle(),
      db.from('surf_follows').select('follower_id').eq('follower_id', person.id).eq('followed_id', window.surfCurrentUserId).maybeSingle()
    ]);
    if (outgoing.error || incoming.error) {
      console.error(outgoing.error || incoming.error);
      button.disabled = false;
      button.textContent = 'Follow';
      toast('Could not load follow status. Please try again.');
      return;
    }
    pageFollowState = { personId: person.id, iFollow: !!outgoing.data, followsMe: !!incoming.data, busy: false };
    renderPageFollowButton();
  }

  function renderPageFollowButton() {
    const button = document.getElementById('pageFollowButton');
    if (!button) return;
    const { iFollow, followsMe, busy } = pageFollowState;
    button.disabled = !!busy;
    button.textContent = iFollow && followsMe ? 'Friends' : iFollow ? 'Following' : followsMe ? 'Follow back' : 'Follow';
    button.dataset.relationship = iFollow && followsMe ? 'friends' : iFollow ? 'following' : followsMe ? 'follow-back' : 'follow';
    button.setAttribute('aria-label', button.textContent);
  }

  window.togglePageFollow = async function() {
    const button = document.getElementById('pageFollowButton');
    const targetId = pageFollowState.personId || currentProfileOwnerId;
    if (!button || !targetId || !window.surfCurrentUserId || targetId === window.surfCurrentUserId || pageFollowState.busy) return;
    const target = activeProfile?.id === targetId ? activeProfile : { id: targetId, username: document.getElementById('pageHandle')?.textContent || 'this user', display_name: document.getElementById('pageName')?.textContent || 'this user' };
    const label = target.display_name || target.username || 'this user';
    const { iFollow, followsMe } = pageFollowState;
    if (iFollow && followsMe && !window.confirm(`Are you sure you want to unfriend ${label}? You will both stop following each other.`)) return;
    if (iFollow && !followsMe && !window.confirm(`Unfollow ${label}?`)) return;
    pageFollowState.busy = true;
    renderPageFollowButton();
    let result;
    if (iFollow && followsMe) {
      result = await db.rpc('surf_unfriend', { target_user_id: targetId });
    } else if (iFollow) {
      result = await db.from('surf_follows').delete().eq('follower_id', window.surfCurrentUserId).eq('followed_id', targetId);
    } else {
      result = await db.from('surf_follows').insert({ follower_id: window.surfCurrentUserId, followed_id: targetId });
    }
    if (result?.error) {
      pageFollowState.busy = false;
      renderPageFollowButton();
      return safeError(result.error, 'Could not update this follow relationship.');
    }
    await refreshPageFollowState(target);
    await loadProfileCounts(targetId);
    await updateOwnCounts();
    toast(iFollow && followsMe ? 'You are no longer friends' : iFollow ? 'Unfollowed ' + label : followsMe ? 'You are now friends with ' + label : 'Following ' + label);
  };

  async function restoreSupabaseSession() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      const profile = await window.loadSurfProfile(data.session.user);
      window.enterApp(profile);
    }
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        window.surfCurrentUserId = null;
        window.surfActiveRecipientId = null;
        window.surfActiveGroupId = null;
        window.enterApp(null);
        showAuthPage('login');
      }
    });
  }

  removeSeedContent();
  normalizeRailTooltips();
  renderSocialAccountSettings();
  enterAppWithLiveData();
  window.openNotifications = openNotifications;
  window.toggleAccount = toggleSocialAccount;
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
  window.stepStory = stepLiveStory;
  window.handleYourStoryClick = () => { if (yourStories.length) openLiveStory({ owner: selfProfile, items: yourStories, isYours: true }); else { resetStoryComposer(); openModal('storyModal'); } };
  window.openStoryViewers = openStoryViewers;
  window.toggleStoryLike = toggleStoryLike;
  window.openStoryArchive = openStoryArchive;
  window.openSavedPosts = openSavedPosts;
  window.openPostComposer = openPostComposer;
  window.publishPost = publishPost;
  window.replyToStory = replyToStory;
  window.toggleStoryOwnMenu = toggleStoryOwnMenu;
  window.archiveCurrentStory = archiveCurrentStory;
  window.deleteCurrentStory = deleteCurrentStory;
  window.renderAllStories = renderAllLiveStories;
  window.openAllStories = () => { renderAllLiveStories(); openModal('storiesPage'); };
  window.openFriendStory = (name) => { const entry = storySets.find((item) => item.owner.display_name === name || item.owner.username === name); if (entry) openLiveStory(entry); };
  window.shareStoryDraft = shareLiveStory;
  window.saveProfileSettings = saveLiveProfile;
  const baseSavePreference = window.savePreference;
  window.savePreference = function(key, value) {
    baseSavePreference?.(key, value);
    if (key !== 'readReceipts' || !window.surfCurrentUserId) return;
    const enabled = Boolean(value);
    selfProfile = { ...selfProfile, read_receipts_enabled: enabled };
    db.from('profiles').update({ read_receipts_enabled: enabled }).eq('id', window.surfCurrentUserId)
      .then(({ error }) => { if (error) safeError(error, 'Could not save read receipt preference.'); });
    if (window.surfActiveRecipientId) {
      const person = findPerson(window.surfActiveRecipientId);
      if (person) loadDirectMessages(person);
    }
  };
  window.syncGroupPicker = syncGroupPicker;
  window.openCreateGroupModal = openLiveCreateGroup;
  document.getElementById('postMediaInput')?.addEventListener('change', (event) => {
    postDraftFile = event.target.files?.[0] || null;
    const preview = document.getElementById('postMediaPreview'); preview.replaceChildren();
    if (!postDraftFile) { preview.textContent = 'No media selected'; return; }
    const url = URL.createObjectURL(postDraftFile);
    if (postDraftFile.type.startsWith('video/')) { const video = document.createElement('video'); video.src = url; video.controls = true; preview.append(video); }
    else { const image = document.createElement('img'); image.src = url; image.alt = 'Post preview'; preview.append(image); }
  });
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
  document.querySelector('.stats')?.replaceChildren(...['Posts','Friends','Following'].map((label) => { const item=document.createElement('div'),value=document.createElement('b');value.textContent='0';item.append(value,document.createTextNode(label));return item; }));
  document.querySelector('.right-title')?.parentElement?.insertAdjacentHTML('afterend', '<p class="friends-empty">Your shared media will appear here.</p>');
  document.querySelector('.chat-top .top-actions')?.setAttribute('style', 'display:none');
  document.getElementById('composer')?.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
  bindSearches();
  bindProfileImageUploads();
  restoreSupabaseSession().catch((error) => {
    console.error('Could not restore Surf session:', error);
    document.getElementById('authError').textContent = error?.message || 'Could not restore your account. Please log in again.';
    showAuthPage('login');
  });
  window.setMyPresence = setLivePresence;
})();
