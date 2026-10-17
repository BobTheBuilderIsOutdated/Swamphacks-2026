const $ = s => document.querySelector(s);
const started = Date.now();
let campaigns = [];
async function message(type, args = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...args });
  if (result.error) throw new Error(result.error); return result;
}
async function perform(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { $('#status').textContent = error.message; }
  finally { button.disabled = false; }
}
async function refresh() {
  const session = await message('session');
  $('#login').hidden = session.authenticated;
  for (const id of ['run', 'source', 'source-campaign']) $(`#${id}`).hidden = !session.authenticated;
  if (!session.authenticated) return;
  const data = await message('dashboard'); campaigns = data.campaigns;
  $('#summary').textContent = `${data.sent} emails sent · ${data.leads.filter(l => l.status === 'positive' || l.status === 'handoff').length} conversations need a look`;
  $('#campaigns').replaceChildren(); $('#source-campaign').replaceChildren();
  for (const c of campaigns) {
    const option = document.createElement('option'); option.value = c.id; option.textContent = c.goal.name; $('#source-campaign').append(option);
    const card = document.createElement('div'); card.className = 'campaign';
    const title = document.createElement('strong'); title.textContent = c.goal.name;
    const detail = document.createElement('p'); detail.textContent = `${c.status} · ${c.goal.location}`;
    card.append(title, detail);
    if (c.status === 'active') { const button = document.createElement('button'); button.textContent = 'Pause'; button.onclick = () => perform(button, async () => { await message('pause', { id: c.id }); await refresh(); }); card.append(button); }
    $('#campaigns').append(card);
  }
}
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#workspace').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
$('#login').onclick = e => perform(e.target, async () => { await message('login'); await refresh(); });
$('#run').onclick = e => perform(e.target, async () => { await message('run'); $('#status').textContent = 'Research and reply processing requested. Check your timeline for progress.'; });
$('#source').onclick = e => perform(e.target, async () => {
  const campaignId = $('#source-campaign').value;
  if (!campaignId) throw new Error('Create a campaign in the workspace first.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://') && !tab?.url?.startsWith('http://')) throw new Error('Open a public research or organization page first.');
  const [captured] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, text: document.body.innerText.slice(0, 60000) }) });
  await message('source', { url: tab.url, campaignId, document: captured.result.text });
  $('#status').textContent = 'Page captured for research. Contact details will be independently verified before outreach.';
});
try { await refresh(); } catch (error) { $('#status').textContent = error.message; }
await new Promise(resolve => setTimeout(resolve, Math.max(0, 2000 - (Date.now() - started))));
$('#splash').hidden = true; $('#panel').hidden = false;
