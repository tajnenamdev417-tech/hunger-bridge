import { useEffect, useMemo, useState } from 'react';
import io from 'socket.io-client';

const API = 'http://localhost:4000/api';
const socket = io('http://localhost:4000');

function App() {
  const [role, setRole] = useState('donor');
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [form, setForm] = useState({ quantity: 10, type: 'Veg', expires: 60, description: '', lat: 12.9716, lng: 77.5946 });
  const [allUsers, setAllUsers] = useState([]);
  const [allPosts, setAllPosts] = useState([]);

  const roleLabel = useMemo(() => ({ donor: 'Donor', ngo: 'NGO', volunteer: 'Volunteer', admin: 'Admin' })[role], [role]);

  const loadData = async () => {
    const resp = await fetch(`${API}/posts?lat=${form.lat}&lng=${form.lng}`);
    setPosts(await resp.json());
    const stats = await fetch(`${API}/analytics`);
    setAnalytics(await stats.json());
  };

  const loadAdminData = async () => {
    if (profile?.role === 'admin') {
      const usersResp = await fetch(`${API}/admin/users`);
      setAllUsers(await usersResp.json());
      const postsResp = await fetch(`${API}/admin/posts`);
      setAllPosts(await postsResp.json());
    }
  };

  useEffect(() => {
    loadData();
    loadAdminData();

    socket.on('post_update', (updated) => {
      setPosts(prev => {
        const idx = prev.findIndex(p => p.id === updated.id);
        if (idx >= 0) return [...prev.slice(0, idx), updated, ...prev.slice(idx+1)];
        return [...prev, updated];
      });
      if (profile?.role === 'admin') {
        setAllPosts(prev => {
          const idx = prev.findIndex(p => p.id === updated.id);
          if (idx >= 0) return [...prev.slice(0, idx), updated, ...prev.slice(idx+1)];
          return [...prev, updated];
        });
      }
    });
    socket.on('dispatch_event', loadData);
    socket.on('delivery_complete', loadData);
    return () => { socket.off('post_update'); socket.off('dispatch_event'); socket.off('delivery_complete'); };
  }, [form.lat, form.lng, profile]);

  const register = async () => {
    const name = prompt('Enter your name or organization name');
    if (!name) return;
    const location = { lat: form.lat, lng: form.lng };
    const resp = await fetch(`${API}/register`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name, role, location}) });
    const data = await resp.json();
    setProfile({ ...data, name, location });
    if (data.role === 'volunteer') socket.emit('volunteer_register_socket', { volunteerId: data.id });
  };

  const createPost = async () => {
    if (!profile) { alert('Register first'); return; }
    const payload = { donorId: profile.id, quantity: form.quantity, type: form.type, location:{lat: form.lat, lng: form.lng}, expiresInMinutes: form.expires, description: form.description };
    await fetch(`${API}/posts`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) });
    await loadData();
  };

  const claim = async (postId) => {
    if (!profile) { alert('Register first'); return; }
    await fetch(`${API}/posts/${postId}/claim`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ngoId: profile.id }) });
    await loadData();
  };

  const deliver = async (postId) => {
    if (!profile) { alert('Register first'); return; }
    await fetch(`${API}/posts/${postId}/deliver`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ volunteerId: profile.id }) });
    await loadData();
  };

  return (
    <div className="app">
      <h1>Hunger Bridge</h1>
      <div className="card">
        <h2>Role</h2>
        <select value={role} onChange={e=>setRole(e.target.value)}>
          <option value="donor">Donor</option>
          <option value="ngo">NGO</option>
          <option value="volunteer">Volunteer</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={register}>Register as {roleLabel}</button>
        {profile && (<p>Logged in as <b>{profile.name}</b> ({profile.role})</p>)}
      </div>

      {profile?.role === 'donor' && (
        <div className="card">
          <h2>Post Surplus Food</h2>
          <label>Type<input value={form.type} onChange={e=>setForm({...form,type:e.target.value})} /></label>
          <label>Quantity<input type="number" value={form.quantity} onChange={e=>setForm({...form,quantity: Number(e.target.value)})} /></label>
          <label>Expiry (mins)<input type="number" value={form.expires} onChange={e=>setForm({...form,expires: Number(e.target.value)})} /></label>
          <label>Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}></textarea></label>
          <button onClick={createPost}>Post Surplus</button>
        </div>
      )}

      <div className="card">
        <h2>Available Posts</h2>
        <div style={{maxHeight: '320px', overflowY:'auto'}}>
          {posts.map(post => (
            <div key={post.id} style={{ marginBottom: 12, padding:8, border:'1px solid #ccc', borderRadius:8 }}>
              <strong>{post.type}</strong> | Qty: {post.quantity} | status: {post.status}
              <div>{post.description}</div>
              <div>ETA left: {Math.max(0, Math.round((post.expiresAt - Date.now())/1000))} sec</div>
              <div>location: ({post.location.lat.toFixed(4)}, {post.location.lng.toFixed(4)})</div>
              {profile?.role === 'ngo' && post.status === 'available' && <button onClick={()=>claim(post.id)}>Claim</button>}
              {profile?.role === 'volunteer' && profile?.id === post.assignedVolunteer && post.status === 'picked' && <button onClick={()=>deliver(post.id)}>Deliver</button>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Impact Dashboard</h2>
        {analytics ? (
          <ul>
            <li>Total posts: {analytics.totalPosts}</li>
            <li>Delivered: {analytics.delivered}</li>
            <li>Expired: {analytics.expired}</li>
            <li>Meals saved (est): {analytics.savedMeals}</li>
            <li>Avg delivery time (min): {analytics.avgDeliveryTime}</li>
          </ul>
        ) : <p>Loading analytics...</p>}
        <button onClick={loadData}>Refresh</button>
      </div>

      {profile?.role === 'admin' && (
        <div className="card">
          <h2>Admin Panel - All Users</h2>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid #ccc'}}>
                <th style={{textAlign:'left', padding:'8px'}}>Name</th>
                <th style={{textAlign:'left', padding:'8px'}}>Role</th>
                <th style={{textAlign:'left', padding:'8px'}}>Status</th>
                <th style={{textAlign:'left', padding:'8px'}}>Location</th>
                <th style={{textAlign:'left', padding:'8px'}}>Created</th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map(user => (
                <tr key={user.id} style={{borderBottom:'1px solid #eee'}}>
                  <td style={{padding:'8px'}}>{user.name}</td>
                  <td style={{padding:'8px'}}>{user.role}</td>
                  <td style={{padding:'8px'}}>{user.status}</td>
                  <td style={{padding:'8px'}}>{user.location ? `${user.location.lat.toFixed(4)}, ${user.location.lng.toFixed(4)}` : 'N/A'}</td>
                  <td style={{padding:'8px'}}>{new Date(user.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={loadAdminData} style={{marginTop:'16px'}}>Refresh Users</button>
        </div>
      )}

      {profile?.role === 'admin' && (
        <div className="card">
          <h2>Admin Panel - All Posts</h2>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid #ccc'}}>
                <th style={{textAlign:'left', padding:'8px'}}>Type</th>
                <th style={{textAlign:'left', padding:'8px'}}>Quantity</th>
                <th style={{textAlign:'left', padding:'8px'}}>Status</th>
                <th style={{textAlign:'left', padding:'8px'}}>Donor</th>
                <th style={{textAlign:'left', padding:'8px'}}>NGO</th>
                <th style={{textAlign:'left', padding:'8px'}}>Volunteer</th>
                <th style={{textAlign:'left', padding:'8px'}}>Created</th>
                <th style={{textAlign:'left', padding:'8px'}}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {allPosts.map(post => (
                <tr key={post.id} style={{borderBottom:'1px solid #eee'}}>
                  <td style={{padding:'8px'}}>{post.type}</td>
                  <td style={{padding:'8px'}}>{post.quantity}</td>
                  <td style={{padding:'8px'}}>{post.status}</td>
                  <td style={{padding:'8px'}}>{post.donorId}</td>
                  <td style={{padding:'8px'}}>{post.ngoId || 'N/A'}</td>
                  <td style={{padding:'8px'}}>{post.assignedVolunteer || 'N/A'}</td>
                  <td style={{padding:'8px'}}>{new Date(post.createdAt).toLocaleString()}</td>
                  <td style={{padding:'8px'}}>{new Date(post.expiresAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={loadAdminData} style={{marginTop:'16px'}}>Refresh Posts</button>
        </div>
      )}

    </div>
  );
}

export default App;
