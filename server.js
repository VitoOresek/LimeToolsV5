const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const usersFile = path.join(__dirname, 'users.json');

let sessions = {}; // token -> user email

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function findUserByEmail(email) {
  const users = loadUsers();
  return users.find(u => u.mail === email);
}

function requireAdmin(req, res, user) {
  if (!user || user.type !== 'admin') {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return false;
  }
  return true;
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const params = new URLSearchParams(body);
    const result = {};
    for (const [k, v] of params.entries()) result[k] = v;
    callback(result);
  });
}

function renderPage(title, content, user) {
  let nav = '<a href="/">Home</a> ';
  if (user) {
    nav += '<a href="/logout">Logout</a> ';
    if (user.type === 'admin') {
      nav += '<a href="/connections">Connections</a> ';
      nav += '<a href="/users">Users</a> ';
    }
  } else {
    nav += '<a href="/login">Login</a>';
  }
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><nav>${nav}</nav>${content}</body></html>`;
}

const server = http.createServer((req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie || '').split('; ').filter(Boolean).map(c => c.split('=')));
  const token = cookies.session;
  const email = sessions[token];
  const user = email ? findUserByEmail(email) : null;

  if (req.method === 'GET' && req.url === '/') {
    res.end(renderPage('Lime Tools', '<p>Welcome to Lime Tools.</p>', user));
    return;
  }

  if (req.method === 'GET' && req.url === '/login') {
    res.end(renderPage('Login', `<form method="POST" action="/login"><label>Email:<input name="mail"/></label><br/><label>Password:<input type="password" name="password"/></label><br/><button type="submit">Login</button></form>`, user));
    return;
  }

  if (req.method === 'POST' && req.url === '/login') {
    parseBody(req, params => {
      const u = findUserByEmail(params.mail);
      if (u && u.password === params.password) {
        const tok = crypto.randomBytes(16).toString('hex');
        sessions[tok] = u.mail;
        res.writeHead(302, { 'Set-Cookie': `session=${tok}; HttpOnly`, Location: '/' });
        res.end();
      } else {
        res.end(renderPage('Login', '<p>Invalid credentials</p>', null));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/logout') {
    if (token) delete sessions[token];
    res.writeHead(302, { 'Set-Cookie': 'session=; Max-Age=0', Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/connections') {
    if (!requireAdmin(req, res, user)) return;
    const content = `<p>Connect your accounts:</p><ul><li>Hubspot - <button>Connect</button></li><li>Linear - <button>Connect</button></li><li>Slack - <button>Connect</button></li></ul>`;
    res.end(renderPage('Connections', content, user));
    return;
  }

  if (req.method === 'GET' && req.url === '/users') {
    if (!requireAdmin(req, res, user)) return;
    const users = loadUsers();
    let rows = users.map(u => `<tr><td>${u.name}</td><td>${u.surname}</td><td>${u.mail}</td><td>${u.type}</td><td><form method="POST" action="/users/delete" style="display:inline"><input type="hidden" name="mail" value="${u.mail}"/><button type="submit">Delete</button></form><form method="POST" action="/users/edit" style="display:inline"><input type="hidden" name="origMail" value="${u.mail}"/><button type="submit">Edit</button></form></td></tr>`).join('');
    const table = `<table border="1"><tr><th>Name</th><th>Surname</th><th>Email</th><th>Type</th><th>Actions</th></tr>${rows}</table>`;
    const form = `<h2>Add User</h2><form method="POST" action="/users/add"><input name="name" placeholder="Name"/> <input name="surname" placeholder="Surname"/> <input name="mail" placeholder="Email"/> <input name="password" placeholder="Password"/> <select name="type"><option value="user">User</option><option value="admin">Admin</option></select> <button type="submit">Add</button></form>`;
    res.end(renderPage('User Management', table + form, user));
    return;
  }

  if (req.method === 'POST' && req.url === '/users/add') {
    if (!requireAdmin(req, res, user)) return;
    parseBody(req, params => {
      const users = loadUsers();
      if (users.find(u => u.mail === params.mail)) {
        res.end(renderPage('Error', '<p>User already exists.</p>', user));
        return;
      }
      users.push({ name: params.name, surname: params.surname, mail: params.mail, password: params.password, type: params.type });
      saveUsers(users);
      res.writeHead(302, { Location: '/users' });
      res.end();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/users/delete') {
    if (!requireAdmin(req, res, user)) return;
    parseBody(req, params => {
      let users = loadUsers();
      users = users.filter(u => u.mail !== params.mail);
      saveUsers(users);
      res.writeHead(302, { Location: '/users' });
      res.end();
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/users/edit') {
    if (!requireAdmin(req, res, user)) return;
    parseBody(req, params => {
      const users = loadUsers();
      const userToEdit = users.find(u => u.mail === params.origMail);
      if (!userToEdit) {
        res.end(renderPage('Error', '<p>User not found.</p>', user));
        return;
      }
      const form = `<form method="POST" action="/users/update"><input type="hidden" name="origMail" value="${userToEdit.mail}"/><input name="name" value="${userToEdit.name}"/><input name="surname" value="${userToEdit.surname}"/><input name="mail" value="${userToEdit.mail}"/><input name="password" value="${userToEdit.password}"/><select name="type"><option value="user" ${userToEdit.type==='user'?'selected':''}>User</option><option value="admin" ${userToEdit.type==='admin'?'selected':''}>Admin</option></select><button type="submit">Update</button></form>`;
      res.end(renderPage('Edit User', form, user));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/users/update') {
    if (!requireAdmin(req, res, user)) return;
    parseBody(req, params => {
      let users = loadUsers();
      const idx = users.findIndex(u => u.mail === params.origMail);
      if (idx === -1) {
        res.end(renderPage('Error', '<p>User not found.</p>', user));
        return;
      }
      users[idx] = { name: params.name, surname: params.surname, mail: params.mail, password: params.password, type: params.type };
      saveUsers(users);
      res.writeHead(302, { Location: '/users' });
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
