/* Read the same CustomDB source used by the parent site's project search. */
window.WorkspaceECSources = {
 async read(sheet) {
  if (sheet !== 'CustomDB') throw Error('Unknown database');
  const endpoint = new URL(window.parent.GAS_URL);
  if (endpoint.origin !== 'https://script.google.com') throw Error('Invalid database source');
  endpoint.searchParams.set('sheet', sheet);
  const response = await fetch(endpoint, {credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(35000)});
  if (!response.ok) throw Error('Database unavailable');
  const [headers, ...data] = await response.json();
  if (!Array.isArray(headers) || !['MTM前4碼','SPB MTM前5碼','機種別代號'].every(h=>headers.includes(h))) throw Error('Invalid database schema');
  return {rows:data.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])))};
 }
};
