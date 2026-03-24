const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const { StatusCodes } = require('http-status-codes');
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hunger_bridge';

const connectMongo = async () => {
  try {
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.warn('MongoDB connection failed, using in-memory only', err.message);
  }
};

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  role: String,
  location: { lat: Number, lng: Number },
  status: String,
  createdAt: Number,
  socketId: String,
  currentJob: String
}, { collection: 'users' });

const postSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  donorId: String,
  quantity: Number,
  type: String,
  description: String,
  location: { lat: Number, lng: Number },
  createdAt: Number,
  expiresAt: Number,
  status: String,
  assignedVolunteer: String,
  ngoId: String,
  assignment: Object,
  claimedAt: Number,
  deliveredAt: Number,
  expiredAt: Number
}, { collection: 'posts' });

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
const PostModel = mongoose.models.Post || mongoose.model('Post', postSchema);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH'] } });

app.use(cors());
app.use(express.json());

const MAX_EXPIRY_MINUTES = 120;
const volunteers = new Map();
const donors = new Map();
const ngos = new Map();
const posts = new Map();

const distanceKm = (a, b) => {
  const toRad = x => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const aa = sinDlat * sinDlat + sinDlon * sinDlon * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
};

const estimateMins = (km) => Math.ceil(km / 0.6);

const getNearestVolunteer = (pickupLocation, deadline) => {
  let best = null;
  for (const volunteer of volunteers.values()) {
    if (volunteer.status !== 'available') continue;
    if (!volunteer.location) continue;
    const dist = distanceKm(volunteer.location, pickupLocation);
    const toPickup = estimateMins(dist);
    const toDelivery = estimateMins( distanceKm(pickupLocation, pickupLocation) );
    const total = toPickup + toDelivery;
    if (Date.now() + total * 60 * 1000 > deadline) continue;
    if (!best || toPickup < best.toPickup) {
      best = {volunteer, toPickup, total, dist};
    }
  }
  return best;
};

const broadcastPostUpdate = (post) => {
  io.emit('post_update', post);
};

const tryAssignVolunteer = (post) => {
  if (post.status !== 'available') return;
  const assignment = getNearestVolunteer(post.location, post.expiresAt);
  if (!assignment) return;
  const volunteer = assignment.volunteer;
  volunteer.status = 'assigned';
  volunteer.currentJob = post.id;
  post.status = 'assigned';
  post.assignedVolunteer = volunteer.id;
  post.assignment = {
    volunteerId: volunteer.id,
    assignedAt: Date.now(),
    etaPickupMins: assignment.toPickup,
    etaDeliveryMins: assignment.total
  };
  if (volunteer.socketId) io.to(volunteer.socketId).emit('assignment', {post, assignedFrom: 'auto'});
  io.emit('dispatch_event', {postId: post.id, volunteerId: volunteer.id});
  broadcastPostUpdate(post);
};

const expireCheck = () => {
  const now = Date.now();
  for (const post of posts.values()) {
    if (post.status === 'delivered' || post.status === 'expired') continue;
    if (now > post.expiresAt) {
      post.status = 'expired';
      post.expiredAt = now;
      broadcastPostUpdate(post);
    }
  }
};
setInterval(expireCheck, 30 * 1000);

app.post('/api/register', (req, res) => {
  const { role, name, location } = req.body;
  if (!role || !name) return res.status(StatusCodes.BAD_REQUEST).json({error: 'role and name are required'});
  const id = nanoid();
  const entity = {id, name, location, createdAt: Date.now(), status: role === 'volunteer' ? 'available' : 'active'};
  const savedUser = { ...entity, id, role };
  if (role === 'volunteer') {
    volunteers.set(id, {...savedUser, socketId: null, currentJob: null});
  } else if (role === 'donor') {
    donors.set(id, savedUser);
  } else if (role === 'ngo') {
    ngos.set(id, savedUser);
  } else if (role === 'admin') {
    // Admin doesn't need location or special handling
    savedUser.status = 'active';
  } else {
    return res.status(StatusCodes.BAD_REQUEST).json({error:'unknown role'});
  }

  UserModel.create({
    id,
    name,
    role,
    location,
    status: savedUser.status,
    createdAt: savedUser.createdAt,
    socketId: null,
    currentJob: null
  }).catch(() => {});

  return res.json({id, role});
});

app.post('/api/posts', (req, res) => {
  const { donorId, quantity, type, location, expiresInMinutes, description } = req.body;
  const donor = donors.get(donorId);
  if (!donor) return res.status(StatusCodes.NOT_FOUND).json({error:'donor not found'});
  const expiry = Math.max(1, Math.min(MAX_EXPIRY_MINUTES, Number(expiresInMinutes)||30));
  const post = {
    id: nanoid(),
    donorId,
    quantity,
    type,
    description,
    location,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiry * 60 * 1000,
    status: 'available',
    assignedVolunteer: null,
    ngoId: null
  };
  posts.set(post.id, post);
  PostModel.create(post).catch(() => {});
  broadcastPostUpdate(post);
  tryAssignVolunteer(post);
  return res.json(post);
});

app.get('/api/posts', (req, res) => {
  const { lat, lng } = req.query;
  let list = Array.from(posts.values()).filter(p => p.status === 'available' || p.status === 'assigned' || p.status==='picked');
  if (lat && lng) {
    const origin = {lat:Number(lat), lng:Number(lng)};
    list = list.map(p => ({...p, distanceKm: distanceKm(origin, p.location)}))
      .sort((a,b)=>a.distanceKm-b.distanceKm)
      .slice(0, 100);
  }
  return res.json(list);
});

app.post('/api/posts/:id/claim', (req, res) => {
  const { ngoId } = req.body;
  const post = posts.get(req.params.id);
  if (!post) return res.status(StatusCodes.NOT_FOUND).json({error:'post not found'});
  const ngo = ngos.get(ngoId);
  if (!ngo) return res.status(StatusCodes.NOT_FOUND).json({error:'ngo not found'});
  if (post.status !== 'available' && post.status !== 'assigned') return res.status(StatusCodes.CONFLICT).json({error:'not claimable'});
  post.status = 'picked';
  post.ngoId = ngoId;
  post.claimedAt = Date.now();
  PostModel.updateOne({ id: post.id }, { status: 'picked', ngoId, claimedAt: post.claimedAt }).catch(()=>{});
  broadcastPostUpdate(post);
  io.emit('ngo_claim', {postId: post.id, ngoId});
  return res.json(post);
});

app.post('/api/posts/:id/deliver', (req, res) => {
  const { volunteerId } = req.body;
  const post = posts.get(req.params.id);
  if (!post) return res.status(StatusCodes.NOT_FOUND).json({error:'post not found'});
  const volunteer = volunteers.get(volunteerId);
  if (!volunteer) return res.status(StatusCodes.NOT_FOUND).json({error:'volunteer not found'});
  post.status = 'delivered';
  post.deliveredAt = Date.now();
  volunteer.status = 'available';
  volunteer.currentJob = null;
  PostModel.updateOne({ id: post.id }, { status: 'delivered', deliveredAt: post.deliveredAt }).catch(()=>{});
  UserModel.updateOne({ id: volunteerId }, { status: 'available', currentJob: null }).catch(()=>{});
  broadcastPostUpdate(post);
  io.emit('delivery_complete', {postId: post.id, volunteerId});
  return res.json(post);
});

app.patch('/api/volunteers/:id/location', (req, res) => {
  const volunteer = volunteers.get(req.params.id);
  if (!volunteer) return res.status(StatusCodes.NOT_FOUND).json({error:'volunteer not found'});
  const { location } = req.body;
  if (location) volunteer.location = location;
  if (req.body.status) volunteer.status = req.body.status;
  volunteers.set(volunteer.id, volunteer);
  UserModel.updateOne({ id: volunteer.id }, { location: volunteer.location, status: volunteer.status }).catch(()=>{});
  io.emit('volunteer_update', volunteer);
  return res.json(volunteer);
});

app.get('/api/admin/users', (req, res) => {
  const allUsers = [];
  for (const user of volunteers.values()) allUsers.push(user);
  for (const user of donors.values()) allUsers.push(user);
  for (const user of ngos.values()) allUsers.push(user);
  return res.json(allUsers);
});

app.get('/api/admin/posts', (req, res) => {
  const allPosts = Array.from(posts.values());
  return res.json(allPosts);
});

io.on('connection', (socket) => {
  socket.emit('connected', {socketId: socket.id});
  socket.on('volunteer_register_socket', ({volunteerId}) => {
    const v = volunteers.get(volunteerId);
    if (v) {
      v.socketId = socket.id;
      volunteers.set(volunteerId, v);
    }
  });
});

const PORT = process.env.PORT || 4000;

connectMongo().finally(() => {
  server.listen(PORT, () => console.log('Hunger Bridge backend running on', PORT));
});
