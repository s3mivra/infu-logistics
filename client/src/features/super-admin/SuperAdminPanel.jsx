import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as auth from '../auth/auth';
import {
  Users, Shield, Menu, X, LogOut, Plus, Edit2, Trash2,
  Search, Eye, EyeOff, AlertCircle, Tag, Loader2, Lock,
  ChevronRight, UserCheck, Monitor, Check, Package, ToggleLeft, ToggleRight,
  KeyRound, Copy
} from 'lucide-react';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

// '' is meaningful: it means same-origin (nginx proxies /api), so use ?? not ||
// - an UNSET var still falls back to the dev LAN box.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';

const ROLE_META = {
  superadmin: { label: 'Superadmin', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Admin:      { label: 'Admin',      bg: 'bg-blue-500/20',    text: 'text-blue-400',    border: 'border-blue-500/30' },
  Staff:      { label: 'Staff',      bg: 'bg-gray-500/20',    text: 'text-gray-400',    border: 'border-gray-500/30' },
};
const getRoleMeta = (role) =>
  ROLE_META[role] ?? { label: role, bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' };

// Built-in roles shown (read-only) in the Access Roles list. Mirrors the server's
// ROLE_DEFAULT_PERMISSIONS (lib/authz.js) for admin & staff. Superadmin is
// intentionally omitted - it bypasses the permission system and must not be
// assignable or presented as an editable role.
const BUILTIN_ROLES = [
  { name: 'Admin', permissions: ['pos.use', 'orders.view', 'orders.manage', 'orders.delete',
    'inventory.view', 'inventory.manage', 'inventory.delete', 'products.view', 'products.manage',
    'procurement.view', 'procurement.manage', 'procurement.delete',
    'accounting.view', 'reports.view', 'analytics.view', 'audit.view', 'settings.manage'] },
  { name: 'Staff', permissions: ['pos.use', 'orders.view', 'inventory.view', 'products.view'] },
];

// ---------------------------------------------------------------------------
// Sub-components (defined outside main component to avoid remount on render)
// ---------------------------------------------------------------------------

const SkeletonRow = () => (
  <div className="animate-pulse flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
    <div className="w-5 h-5 bg-white/10 rounded" />
    <div className="w-10 h-10 bg-white/10 rounded-xl flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-4 bg-white/10 rounded w-1/3" />
      <div className="h-3 bg-white/5 rounded w-1/4" />
    </div>
    <div className="w-20 h-6 bg-white/10 rounded-full" />
    <div className="flex gap-2">
      <div className="w-8 h-8 bg-white/10 rounded-lg" />
      <div className="w-8 h-8 bg-white/10 rounded-lg" />
    </div>
  </div>
);

const UserCard = memo(({ user, isSelected, onSelect, onEdit, onDelete }) => {
  const meta = getRoleMeta(user.role);
  const isProtected = user.role === 'superadmin';
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-150
      ${isSelected ? 'bg-brand/10 border-brand/40' : 'bg-white/5 border-white/5 hover:border-white/15'}`}
    >
      <button
        onClick={() => !isProtected && onSelect(user._id)}
        className={`w-5 h-5 flex-shrink-0 rounded border flex items-center justify-center transition
          ${isProtected ? 'opacity-0 pointer-events-none' : isSelected
            ? 'bg-brand border-brand' : 'border-fg/60 hover:border-brand'}`}
        aria-label={isSelected ? 'Deselect' : 'Select'}
      >
        {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
      </button>

      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${meta.bg} ${meta.text}`}>
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-fg truncate">{user.name}</p>
        <p className="text-xs text-fg/40 font-mono">{user.userCode}</p>
      </div>

      <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border flex-shrink-0
        ${meta.bg} ${meta.text} ${meta.border}`}>
        {meta.label}
      </span>

      {!isProtected ? (
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(user)}
            className="p-2 rounded-lg text-fg/40 hover:text-fg hover:bg-white/10 transition"
            aria-label={`Edit ${user.name}`}
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(user)}
            className="p-2 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition"
            aria-label={`Delete ${user.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <Lock size={13} className="text-fg/20 flex-shrink-0" />
      )}
    </div>
  );
});
UserCard.displayName = 'UserCard';

// Client Accounts belongs to the client portal, which is a logistics-only feature.
// Hide the panel entirely for non-log business types (e.g. fb).
const NAV_ITEMS = [
  { id: 'users', label: 'User Control',  icon: Users },
  { id: 'roles', label: 'Access Roles',  icon: Tag },
  ...(BUSINESS_TYPE === 'log' ? [{ id: 'clients', label: 'Client Accounts', icon: Package }] : []),
];

function SidebarNav({ activeSection, onSectionChange, onPOS, onLogout, onClose }) {
  return (
    <>
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand/20 flex items-center justify-center flex-shrink-0">
            <Monitor size={16} className="text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-fg text-xs uppercase tracking-widest leading-none">Command</p>
            <p className="font-black text-brand text-xs uppercase tracking-widest leading-none mt-0.5">Center</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded text-fg/30 hover:text-fg transition" aria-label="Close menu">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onSectionChange(id); onClose?.(); }}
            aria-current={activeSection === id ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm
              ${activeSection === id ? 'bg-brand/20 text-brand' : 'text-fg/50 hover:text-fg hover:bg-white/5'}`}
          >
            <Icon size={16} />
            {label}
            {activeSection === id && <ChevronRight size={13} className="ml-auto" />}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-white/5 space-y-0.5">
        <button
          onClick={onPOS}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-fg/40 hover:text-fg hover:bg-white/5 transition font-bold text-sm"
        >
          <Monitor size={16} />
          POS Dashboard
        </button>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition font-bold text-sm"
        >
          <LogOut size={16} />
          Lock Panel
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const EMPTY_FORM = { name: '', password: '', role: 'Staff', showPassword: false, permissions: [], customPerms: false, commissionRate: '' };

export default function SuperAdminPanel() {
  const navigate = useNavigate();

  // Auth - access token lives in memory; restored via silent refresh on mount.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    auth.refreshSession(API_URL).then((data) => {
      if (cancelled) return;
      // This panel is superadmin-only - only authenticate if the role matches.
      if (data?.user?.role === 'superadmin') setIsAuthenticated(true);
      setAuthBootstrapping(false);
    });
    return () => { cancelled = true; };
  }, []);
  const [loginForm, setLoginForm]   = useState({ name: '', password: '', showPassword: false });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Data
  const [users, setUsers]     = useState([]);
  const [roles, setRoles]     = useState([]);
  const [permCatalog, setPermCatalog] = useState([]); // [{ key, group, label }]
  const [loading, setLoading] = useState(false);

  // Search / filter
  const [search, setSearch]       = useState('');
  const [filterRole, setFilterRole] = useState('All');

  // Batch selection
  const [selected, setSelected]     = useState(new Set());
  const [batchRole, setBatchRole]   = useState('');
  const [batchLoading, setBatchLoading] = useState(false);

  // Create / Edit modal
  const [modal, setModal]           = useState({ open: false, mode: 'create', user: null });
  const [form, setForm]             = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [formLoading, setFormLoading] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState({ open: false, user: null });
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Navigation / layout
  const [activeSection, setActiveSection] = useState('users');
  const [drawerOpen, setDrawerOpen]       = useState(false);

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Roles form - name + the granular permissions this role grants by default.
  const [roleForm, setRoleForm]       = useState({ id: null, name: '', permissions: [] });
  const [roleLoading, setRoleLoading] = useState(false);

  // Client accounts (logistics mode)
  const [clients, setClients]           = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientModal, setClientModal]   = useState({ open: false, mode: 'create', client: null });
  // Reset-password flow: confirm your OWN password first, then a freshly-
  // generated client password is shown exactly once (it can't be shown again
  // later - it's bcrypt-hashed the moment the server issues it).
  const [resetPwModal, setResetPwModal] = useState({ open: false, client: null, confirmPassword: '', loading: false, error: '', result: null });
  const [clientForm, setClientForm]     = useState({ username: '', password: '', name: '', paymentMethod: 'Cash', isActive: true, showPassword: false, creditLimit: '' });
  const [clientFormLoading, setClientFormLoading] = useState(false);
  const [clientFormError, setClientFormError] = useState('');

  // -------------------------------------------------------------------------
  const showToast = useCallback((message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3000);
  }, []);

  const apiFetch = useCallback(async (endpoint, options = {}) => {
    const res = await auth.apiFetch(API_URL, endpoint, options);
    if ((res.status === 401 || res.status === 403) && endpoint !== '/api/users/login') handleLogout();
    return res;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/users');
      if (res.ok) setUsers((await res.json()).users || []);
    } catch {} finally { setLoading(false); }
  }, [apiFetch]);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await apiFetch('/api/roles');
      if (res.ok) setRoles((await res.json()).roles || []);
    } catch {}
  }, [apiFetch]);

  const fetchPermCatalog = useCallback(async () => {
    try {
      const res = await apiFetch('/api/permissions');
      if (res.ok) setPermCatalog((await res.json()).permissions || []);
    } catch {}
  }, [apiFetch]);

  useEffect(() => {
    if (isAuthenticated) { fetchUsers(); fetchRoles(); fetchPermCatalog(); }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Filtered users (memoised)
  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(u => {
      const matchSearch = !q
        || u.name.toLowerCase().includes(q)
        || u.userCode?.toLowerCase().includes(q)
        || u.role?.toLowerCase().includes(q);
      const matchRole = filterRole === 'All' || u.role === filterRole;
      return matchSearch && matchRole;
    });
  }, [users, search, filterRole]);

  const selectableUsers = useMemo(() => filteredUsers.filter(u => u.role !== 'superadmin'), [filteredUsers]);

  // -------------------------------------------------------------------------
  // Auth handlers
  const handleSystemLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await apiFetch('/api/users/login', {
        method: 'POST',
        body: JSON.stringify({ name: loginForm.name, password: loginForm.password }),
      });
      const data = await res.json();
      if (data.success) {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        if (payload.role !== 'superadmin') {
          setLoginError('Access Denied: Superadmin credentials required.');
          return;
        }
        auth.setToken(data.token);
        setIsAuthenticated(true);
      } else {
        // Surface the server's reason (e.g. rate-limit lockout) rather than
        // always blaming the credentials - see AdminDashboard.handleSystemLogin.
        setLoginError(res.status === 429
          ? (data.error || 'Too many failed attempts. Please wait and try again.')
          : (data.error || 'Invalid name or password.'));
      }
    } catch { setLoginError('Network error. Please try again.'); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = useCallback(() => {
    auth.logout(API_URL); // revoke refresh session + clear cookie
    auth.clearToken();
    setIsAuthenticated(false);
    setLoginForm({ name: '', password: '', showPassword: false });
    setUsers([]);
    setSelected(new Set());
  }, []);

  // -------------------------------------------------------------------------
  // Validation
  const validateForm = useCallback((f, mode, editingUser) => {
    const errors = {};
    const trimmed = f.name.trim();
    if (!trimmed) errors.name = 'Name is required.';
    else if (trimmed.length < 2) errors.name = 'Name must be at least 2 characters.';
    else {
      const exists = users.some(
        u => u.name.toLowerCase() === trimmed.toLowerCase()
          && (mode === 'create' || u._id !== editingUser?._id)
      );
      if (exists) errors.name = 'This name is already taken.';
    }
    if (mode === 'create' && !f.password) errors.password = 'Password is required.';
    else if (f.password && f.password.length < 4) errors.password = 'Password must be at least 4 characters.';
    return errors;
  }, [users]);

  // -------------------------------------------------------------------------
  // Modal helpers
  const openCreateModal = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModal({ open: true, mode: 'create', user: null });
  }, []);

  const openEditModal = useCallback((user) => {
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    setForm({ name: user.name, password: '', role: user.role, showPassword: false, permissions: perms, customPerms: perms.length > 0, commissionRate: user.commissionRate ?? '' });
    setFormErrors({});
    setModal({ open: true, mode: 'edit', user });
  }, []);

  const closeModal = useCallback(() => {
    setModal({ open: false, mode: 'create', user: null });
    setForm(EMPTY_FORM);
    setFormErrors({});
  }, []);

  const handleFormChange = useCallback((field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      setFormErrors(validateForm(next, modal.mode, modal.user));
      return next;
    });
  }, [validateForm, modal.mode, modal.user]);

  // Toggle a single permission in the custom override set.
  const togglePerm = useCallback((key) => {
    setForm(prev => {
      const has = prev.permissions.includes(key);
      return { ...prev, permissions: has ? prev.permissions.filter(k => k !== key) : [...prev.permissions, key] };
    });
  }, []);

  // Permission catalogue grouped by domain, for the editor. [ [group, [perm,...]], ... ]
  const groupedPerms = useMemo(() => {
    const by = {};
    for (const p of permCatalog) { (by[p.group] = by[p.group] || []).push(p); }
    return Object.entries(by);
  }, [permCatalog]);

  const handleSubmitModal = async (e) => {
    e.preventDefault();
    const errors = validateForm(form, modal.mode, modal.user);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setFormLoading(true);
    try {
      // Explicit permission override only when "custom permissions" is on;
      // otherwise send [] so the server falls back to the role's defaults.
      const permsPayload = form.customPerms ? (form.permissions || []) : [];
      if (modal.mode === 'create') {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ name: form.name.trim(), password: form.password, role: form.role, permissions: permsPayload }),
        });
        const data = await res.json();
        if (data.success) { showToast('User created.'); closeModal(); fetchUsers(); }
        else setFormErrors({ general: data.error || 'Failed to create user.' });
      } else {
        const body = { name: form.name.trim(), role: form.role, permissions: permsPayload };
        if (form.password) body.password = form.password;
        if (form.commissionRate !== '') body.commissionRate = form.commissionRate;
        const res = await apiFetch(`/api/users/${modal.user._id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) { showToast('User updated.'); closeModal(); fetchUsers(); }
        else setFormErrors({ general: data.error || 'Failed to update user.' });
      }
    } catch { setFormErrors({ general: 'Network error. Please try again.' }); }
    finally { setFormLoading(false); }
  };

  // -------------------------------------------------------------------------
  // Delete
  const handleDeleteUser = async () => {
    if (!confirmDelete.user) return;
    setDeleteLoading(true);
    try {
      const res = await apiFetch(`/api/users/${confirmDelete.user._id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`${confirmDelete.user.name} removed.`);
        setSelected(s => { const n = new Set(s); n.delete(confirmDelete.user._id); return n; });
        setConfirmDelete({ open: false, user: null });
        fetchUsers();
      } else { showToast('Failed to remove user.', 'error'); }
    } finally { setDeleteLoading(false); }
  };

  // -------------------------------------------------------------------------
  // Batch
  const toggleSelect = useCallback((id) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(selectableUsers.length && selected.size === selectableUsers.length
      ? new Set()
      : new Set(selectableUsers.map(u => u._id))
    );
  }, [selected, selectableUsers]);

  const handleBatchChangeRole = async () => {
    if (!batchRole || !selected.size) return;
    setBatchLoading(true);
    try {
      await Promise.all([...selected].map(id =>
        apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: batchRole }) })
      ));
      showToast(`Role updated for ${selected.size} user(s).`);
      setSelected(new Set()); setBatchRole(''); fetchUsers();
    } catch { showToast('Failed to update roles.', 'error'); }
    finally { setBatchLoading(false); }
  };

  const handleBatchDelete = async () => {
    if (!selected.size) return;
    setBatchLoading(true);
    try {
      await Promise.all([...selected].map(id => apiFetch(`/api/users/${id}`, { method: 'DELETE' })));
      showToast(`${selected.size} user(s) removed.`);
      setSelected(new Set()); fetchUsers();
    } catch { showToast('Failed to remove users.', 'error'); }
    finally { setBatchLoading(false); }
  };

  // -------------------------------------------------------------------------
  // Role management
  const resetRoleForm = () => setRoleForm({ id: null, name: '', permissions: [] });
  const editRole = (r) => setRoleForm({ id: r._id, name: r.name, permissions: Array.isArray(r.permissions) ? r.permissions : [] });
  const toggleRolePerm = (key) => setRoleForm(prev => ({
    ...prev,
    permissions: prev.permissions.includes(key) ? prev.permissions.filter(k => k !== key) : [...prev.permissions, key],
  }));

  const handleSaveRole = async (e) => {
    e.preventDefault();
    if (!roleForm.name.trim()) return;
    setRoleLoading(true);
    try {
      const body = JSON.stringify({ name: roleForm.name.trim(), permissions: roleForm.permissions });
      const res = roleForm.id
        ? await apiFetch(`/api/roles/${roleForm.id}`, { method: 'PATCH', body })
        : await apiFetch('/api/roles', { method: 'POST', body });
      const data = await res.json();
      if (data.success) { resetRoleForm(); fetchRoles(); showToast(roleForm.id ? 'Role updated.' : 'Role added.'); }
      else showToast(data.error || 'Failed to save role.', 'error');
    } catch { showToast('Network error saving role.', 'error'); }
    finally { setRoleLoading(false); }
  };

  const handleDeleteRole = async (id, name) => {
    try {
      await apiFetch(`/api/roles/${id}`, { method: 'DELETE' });
      fetchRoles(); showToast(`"${name}" removed.`);
    } catch { showToast('Failed to delete role.', 'error'); }
  };

  // -------------------------------------------------------------------------
  // Client accounts (logistics mode)
  const fetchClients = useCallback(async () => {
    if (BUSINESS_TYPE !== 'log') return;
    setClientsLoading(true);
    try {
      const res = await apiFetch('/api/client-accounts');
      if (res.ok) setClients((await res.json()).clients || []);
    } catch {} finally { setClientsLoading(false); }
  }, [apiFetch]);

  useEffect(() => {
    if (isAuthenticated) fetchClients();
  }, [isAuthenticated, fetchClients]);

  const openClientCreate = () => {
    setClientForm({ username: '', password: '', name: '', paymentMethod: 'Cash', isActive: true, showPassword: false, creditLimit: '', creditTermsDays: '', segments: '' });
    setClientFormError('');
    setClientModal({ open: true, mode: 'create', client: null });
  };

  const openClientEdit = (client) => {
    // null/undefined means "no limit set"; 0 is a real value (cash only), so it
    // must render as "0" rather than collapsing to an empty field.
    setClientForm({ username: client.username, password: '', name: client.name, paymentMethod: client.paymentMethod, isActive: client.isActive, showPassword: false, creditLimit: client.creditLimit === null || client.creditLimit === undefined ? '' : String(client.creditLimit), creditTermsDays: client.creditTermsDays === null || client.creditTermsDays === undefined ? '' : String(client.creditTermsDays), segments: (client.segments || []).join(', ') });
    setClientFormError('');
    setClientModal({ open: true, mode: 'edit', client });
  };

  const closeClientModal = () => setClientModal({ open: false, mode: 'create', client: null });

  const handleClientSubmit = async (e) => {
    e.preventDefault();
    setClientFormError('');
    if (!clientForm.username.trim() || !clientForm.name.trim()) {
      setClientFormError('Username and name are required.'); return;
    }
    if (clientModal.mode === 'create' && !clientForm.password) {
      setClientFormError('Password is required.'); return;
    }
    setClientFormLoading(true);
    const segments = (clientForm.segments || '').split(',').map(s => s.trim()).filter(Boolean);
    try {
      if (clientModal.mode === 'create') {
        const res = await apiFetch('/api/client-accounts', {
          method: 'POST',
          body: JSON.stringify({ username: clientForm.username.trim(), password: clientForm.password, name: clientForm.name.trim(), paymentMethod: clientForm.paymentMethod, creditLimit: clientForm.creditLimit, creditTermsDays: clientForm.creditTermsDays, segments }),
        });
        const data = await res.json();
        if (data.success) { showToast('Client account created.'); closeClientModal(); fetchClients(); }
        else setClientFormError(data.error || 'Failed to create client.');
      } else {
        const body = { name: clientForm.name.trim(), paymentMethod: clientForm.paymentMethod, isActive: clientForm.isActive, creditLimit: clientForm.creditLimit, creditTermsDays: clientForm.creditTermsDays, segments };
        if (clientForm.username.trim()) body.username = clientForm.username.trim();
        if (clientForm.password) body.password = clientForm.password;
        const res = await apiFetch(`/api/client-accounts/${clientModal.client._id}`, { method: 'PATCH', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) { showToast('Client updated.'); closeClientModal(); fetchClients(); }
        else setClientFormError(data.error || 'Failed to update client.');
      }
    } catch { setClientFormError('Network error.'); }
    finally { setClientFormLoading(false); }
  };

  const handleClientDelete = async (client) => {
    if (!confirm(`Remove client account "${client.name}"?`)) return;
    try {
      await apiFetch(`/api/client-accounts/${client._id}`, { method: 'DELETE' });
      showToast(`${client.name} removed.`); fetchClients();
    } catch { showToast('Failed to remove client.', 'error'); }
  };

  const toggleClientActive = async (client) => {
    try {
      await apiFetch(`/api/client-accounts/${client._id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !client.isActive }) });
      fetchClients();
    } catch { showToast('Failed to update status.', 'error'); }
  };

  const openResetPassword = (client) => setResetPwModal({ open: true, client, confirmPassword: '', loading: false, error: '', result: null });
  const closeResetPassword = () => setResetPwModal({ open: false, client: null, confirmPassword: '', loading: false, error: '', result: null });

  const handleResetPasswordConfirm = async (e) => {
    e.preventDefault();
    if (!resetPwModal.confirmPassword) { setResetPwModal(m => ({ ...m, error: 'Enter your password to continue.' })); return; }
    setResetPwModal(m => ({ ...m, loading: true, error: '' }));
    try {
      const res = await apiFetch(`/api/client-accounts/${resetPwModal.client._id}/reset-password`, {
        method: 'POST', body: JSON.stringify({ confirmPassword: resetPwModal.confirmPassword }),
      });
      const data = await res.json();
      if (data.success) setResetPwModal(m => ({ ...m, loading: false, result: data.newPassword }));
      else setResetPwModal(m => ({ ...m, loading: false, error: data.error || 'Failed to reset password.' }));
    } catch { setResetPwModal(m => ({ ...m, loading: false, error: 'Network error.' })); }
  };

  // -------------------------------------------------------------------------
  // Derived
  const sectionLabel = NAV_ITEMS.find(n => n.id === activeSection)?.label ?? '';
  const allSelected = selectableUsers.length > 0 && selected.size === selectableUsers.length;
  const hasFormErrors = Object.keys(formErrors).some(k => k !== 'general' && formErrors[k]);

  // =========================================================================
  // LOGIN SCREEN
  // =========================================================================
  if (authBootstrapping) {
    return (
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-fg/60 text-sm">
        Restoring session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col items-center justify-center p-4">
        <form onSubmit={handleSystemLogin} className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-brand/20 flex items-center justify-center mb-4">
              <Shield size={26} className="text-brand" />
            </div>
            <h2 className="text-xl font-black text-fg uppercase tracking-widest">Command Center</h2>
            <p className="text-fg/40 text-xs mt-1">Superadmin credentials required</p>
          </div>

          {loginError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-5">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <div className="space-y-3 mb-5">
            <input
              type="text"
              placeholder="Admin Name"
              aria-label="Admin Name"
              value={loginForm.name}
              onChange={e => setLoginForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/30 px-4 py-3 rounded-xl outline-none transition text-sm font-medium"
              required
              autoFocus
            />
            <div className="relative">
              <input
                type={loginForm.showPassword ? 'text' : 'password'}
                placeholder="Password"
                aria-label="Password"
                value={loginForm.password}
                onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/30 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest"
                required
              />
              <button
                type="button"
                onClick={() => setLoginForm(f => ({ ...f, showPassword: !f.showPassword }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition"
                aria-label={loginForm.showPassword ? 'Hide password' : 'Show password'}
              >
                {loginForm.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loginLoading}
            className="w-full bg-brand hover:bg-brand-dark text-fg font-black py-3 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loginLoading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            {loginLoading ? 'Authenticating…' : 'Authenticate'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="w-full text-fg/30 hover:text-fg/60 text-xs font-bold uppercase tracking-widest transition mt-4"
          >
            Return to POS
          </button>
        </form>
      </div>
    );
  }

  // =========================================================================
  // MAIN SHELL
  // =========================================================================
  return (
    <div className="min-h-screen bg-page-bg flex text-fg">

      {/* Toast */}
      <div className={`fixed top-4 right-4 z-[100] transition-all duration-300
        ${toast.show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-bold
          ${toast.type === 'success'
            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/20 border-red-500/30 text-red-400'}`}>
          {toast.type === 'success' ? <UserCheck size={14} /> : <AlertCircle size={14} />}
          {toast.message}
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside className={`lg:hidden fixed top-0 left-0 h-full w-64 bg-sidebar-bg z-50 flex flex-col border-r border-white/5
        transition-transform duration-300 ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <SidebarNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onPOS={() => navigate('/admin')}
          onLogout={handleLogout}
          onClose={() => setDrawerOpen(false)}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-sidebar-bg border-r border-white/5 h-screen sticky top-0 overflow-y-auto">
        <SidebarNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onPOS={() => navigate('/admin')}
          onLogout={handleLogout}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-16 bg-sidebar-bg border-b border-white/5 flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-xl text-fg/50 hover:text-fg hover:bg-white/10 transition"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={21} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-black text-fg text-sm uppercase tracking-widest truncate">Command Center</p>
            <p className="text-brand text-[10px] font-bold uppercase tracking-[0.15em] truncate">
              Management &rsaquo; {sectionLabel}
            </p>
          </div>
        </header>

        {/* Sticky section header */}
        <div className="sticky top-0 z-20 bg-page-bg/90 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-fg/80 text-[10px] font-bold uppercase tracking-[0.2em]">
              Management &rsaquo; {sectionLabel}
            </p>
            <h1 className="text-xl font-black text-fg mt-0.5">{sectionLabel}</h1>
          </div>
          {activeSection === 'users' && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold px-4 py-2.5 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex-shrink-0"
            >
              <Plus size={15} />
              New User
            </button>
          )}
          {activeSection === 'clients' && (
            <button
              onClick={openClientCreate}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-fg font-bold px-4 py-2.5 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex-shrink-0"
            >
              <Plus size={15} />
              New Client
            </button>
          )}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* USERS SECTION                                                      */}
        {/* ----------------------------------------------------------------- */}
        {activeSection === 'users' && (
          <div className="flex-1 p-6 space-y-4">

            {/* Search + filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
                <input
                  type="text"
                  placeholder="Search name, code, or role…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-fg/30
                    pl-10 pr-4 py-2.5 rounded-xl outline-none transition text-sm"
                />
              </div>
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className="bg-white/5 border border-white/10 focus:border-brand text-fg px-4 py-2.5 rounded-xl outline-none text-sm font-medium"
              >
                <option className="bg-surface text-fg" value="All">All Roles</option>
                <option className="bg-surface text-fg" value="superadmin">Superadmin</option>
                <option className="bg-surface text-fg" value="Admin">Admin</option>
                <option className="bg-surface text-fg" value="Staff">Staff</option>
                {roles.map(r => <option className="bg-surface text-fg" key={r._id} value={r.name}>{r.name}</option>)}
              </select>
            </div>

            {/* Select-all row */}
            {!loading && filteredUsers.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-2 text-xs font-bold text-accent hover:text-fg transition uppercase tracking-wider"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition
                    ${allSelected ? 'bg-brand border-brand' : 'border-fg/60'}`}>
                    {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
                {selected.size > 0 && (
                  <span className="text-brand text-xs font-bold">{selected.size} selected</span>
                )}
              </div>
            )}

            {/* User cards */}
            <div className="space-y-2">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : filteredUsers.length === 0
                  ? (
                    <div className="flex flex-col items-center py-20 text-center">
                      <Users size={40} className="text-fg/10 mb-4" />
                      <p className="text-fg/40 font-bold text-sm mb-1">
                        {search ? 'No users match your search.' : 'No users yet.'}
                      </p>
                      {!search && (
                        <button
                          onClick={openCreateModal}
                          className="mt-4 flex items-center gap-2 bg-brand/20 hover:bg-brand/30 text-brand font-bold px-4 py-2 rounded-xl transition text-sm"
                        >
                          <Plus size={14} /> Create First User
                        </button>
                      )}
                    </div>
                  )
                  : filteredUsers.map(user => (
                    <UserCard
                      key={user._id}
                      user={user}
                      isSelected={selected.has(user._id)}
                      onSelect={toggleSelect}
                      onEdit={openEditModal}
                      onDelete={(u) => setConfirmDelete({ open: true, user: u })}
                    />
                  ))
              }
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* CLIENT ACCOUNTS SECTION (logistics mode only)                     */}
        {/* ----------------------------------------------------------------- */}
        {activeSection === 'clients' && (
          <div className="flex-1 p-6 space-y-3">
            {clientsLoading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              : clients.length === 0
                ? (
                  <div className="flex flex-col items-center py-20 text-center">
                    <Package size={40} className="text-fg/10 mb-4" />
                    <p className="text-fg/40 font-bold text-sm">No client accounts yet.</p>
                    <button
                      onClick={openClientCreate}
                      className="mt-4 flex items-center gap-2 bg-brand/20 hover:bg-brand/30 text-brand font-bold px-4 py-2 rounded-xl transition text-sm"
                    >
                      <Plus size={14} /> Add First Client
                    </button>
                  </div>
                )
                : clients.map(client => (
                  <div key={client._id} className="flex items-center gap-4 p-4 rounded-xl border bg-white/5 border-white/5 hover:border-white/15 transition-all">
                    <div className="w-10 h-10 rounded-xl bg-brand/20 flex items-center justify-center font-black text-sm text-brand flex-shrink-0">
                      {client.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-fg truncate">{client.name}</p>
                      <p className="text-xs text-fg/40 font-mono">
                        {client.clientCode} · {client.source === 'pos' ? 'no portal login (auto-promoted)' : `@${client.username}`}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-fg/50 bg-white/10 px-2 py-1 rounded-full flex-shrink-0">
                      {client.paymentMethod}
                    </span>
                    <button
                      onClick={() => toggleClientActive(client)}
                      className={`flex-shrink-0 transition ${client.isActive ? 'text-emerald-400' : 'text-fg/20'}`}
                      title={client.isActive ? 'Active - click to deactivate' : 'Inactive - click to activate'}
                    >
                      {client.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openClientEdit(client)} className="p-2 rounded-lg text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Edit">
                        <Edit2 size={14} />
                      </button>
                      {client.source !== 'pos' && (
                        <button onClick={() => openResetPassword(client)} className="p-2 rounded-lg text-fg/40 hover:text-fg hover:bg-white/10 transition" aria-label="Reset password" title="Reset password">
                          <KeyRound size={14} />
                        </button>
                      )}
                      <button onClick={() => handleClientDelete(client)} className="p-2 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition" aria-label="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
            }
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* ROLES SECTION                                                      */}
        {/* ----------------------------------------------------------------- */}
        {activeSection === 'roles' && (
          <div className="flex-1 p-6 max-w-2xl">
            {/* Role maker - name + the permissions this role grants by default */}
            <form onSubmit={handleSaveRole} className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-black text-fg text-sm">{roleForm.id ? 'Edit Role' : 'New Role'}</h3>
                {roleForm.id && (
                  <button type="button" onClick={resetRoleForm} className="text-xs font-bold text-fg/40 hover:text-fg transition">Cancel edit</button>
                )}
              </div>
              <input
                type="text"
                placeholder="Role name (e.g. Barista, Bookkeeper)"
                value={roleForm.name}
                onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-fg/30 px-4 py-2.5 rounded-xl outline-none transition text-sm mb-4"
              />

              <p className="text-[10px] font-bold text-fg/80 uppercase tracking-widest mb-2">What this role can do</p>
              <div className="space-y-3 bg-black/20 border border-white/10 rounded-xl p-3 max-h-72 overflow-y-auto">
                {groupedPerms.length === 0 && <p className="text-fg/30 text-xs">Loading permissions…</p>}
                {groupedPerms.map(([group, perms]) => (
                  <div key={group}>
                    <p className="text-[10px] font-black uppercase tracking-wider text-fg/80 mb-1">{group}</p>
                    <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
                      {perms.map(p => (
                        <label key={p.key} className="flex items-center gap-2 text-[13px] text-fg/70 cursor-pointer hover:text-fg transition">
                          <input type="checkbox" checked={roleForm.permissions.includes(p.key)} onChange={() => toggleRolePerm(p.key)} className="accent-brand shrink-0" />
                          <span className="leading-tight">{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  type="submit"
                  disabled={roleLoading || !roleForm.name.trim()}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold px-5 py-2.5 rounded-xl transition disabled:opacity-50 text-sm"
                >
                  {roleLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {roleForm.id ? 'Save Role' : 'Add Role'}
                </button>
              </div>
            </form>

            <div className="space-y-2">
              {/* Built-in roles (read-only). Superadmin is deliberately excluded. */}
              {BUILTIN_ROLES.map(r => (
                <div key={r.name} className="bg-white/5 border border-white/5 px-5 py-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Lock size={13} className="text-fg/40" />
                      <span className="font-bold text-fg text-sm">{r.name}</span>
                      <span className="text-fg/30 text-xs">{r.permissions.length} permissions</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-white/5 text-fg/40 border border-white/10 px-2 py-0.5 rounded-full">Built-in</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pl-6">
                    {r.permissions.map(k => {
                      const meta = permCatalog.find(p => p.key === k);
                      return <span key={k} className="text-[10px] font-bold bg-white/5 border border-white/10 text-fg/50 px-2 py-0.5 rounded-full">{meta ? meta.label : k}</span>;
                    })}
                  </div>
                </div>
              ))}
              {roles.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <Tag size={32} className="text-fg/10 mb-3" />
                  <p className="text-fg/40 font-bold text-sm">No custom roles yet.</p>
                  <p className="text-fg/20 text-xs mt-1">Create one above to extend beyond the built-in roles.</p>
                </div>
              ) : roles.map(r => (
                <div
                  key={r._id}
                  className="bg-white/5 hover:bg-white/[0.07] border border-white/5 px-5 py-4 rounded-xl transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Tag size={13} className="text-brand" />
                      <span className="font-bold text-fg text-sm">{r.name}</span>
                      <span className="text-fg/30 text-xs">{(r.permissions?.length || 0)} permission{(r.permissions?.length === 1 ? '' : 's')}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => editRole(r)}
                        className="p-1.5 rounded-lg text-fg/40 hover:text-fg hover:bg-white/10 transition"
                        aria-label={`Edit ${r.name} role`}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRole(r._id, r.name)}
                        className="p-1.5 rounded-lg text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition"
                        aria-label={`Delete ${r.name} role`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {r.permissions?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5 pl-6">
                      {r.permissions.map(k => {
                        const meta = permCatalog.find(p => p.key === k);
                        return <span key={k} className="text-[10px] font-bold bg-brand/10 border border-brand/25 text-brand/90 px-2 py-0.5 rounded-full">{meta ? meta.label : k}</span>;
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* BATCH ACTION FLOATING BAR                                            */}
      {/* =================================================================== */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 right-4 -translate-x-1/2 z-30 flex items-center gap-3
          bg-surface-2 border border-white/15 shadow-2xl px-5 py-3 rounded-2xl animate-fade-in">
          <span className="text-fg/80 text-sm font-bold whitespace-nowrap">{selected.size} selected</span>
          <div className="w-px h-5 bg-white/10 flex-shrink-0" />
          <select
            value={batchRole}
            onChange={e => setBatchRole(e.target.value)}
            className="bg-white/10 border border-white/10 text-fg text-sm px-3 py-1.5 rounded-lg outline-none"
          >
            <option className="bg-surface text-fg" value="">Change role…</option>
            <option className="bg-surface text-fg" value="Admin">Admin</option>
            <option className="bg-surface text-fg" value="Staff">Staff</option>
            {roles.map(r => <option className="bg-surface text-fg" key={r._id} value={r.name}>{r.name}</option>)}
          </select>
          <button
            onClick={handleBatchChangeRole}
            disabled={!batchRole || batchLoading}
            className="flex items-center gap-1.5 bg-brand/20 hover:bg-brand/30 text-brand font-bold px-3 py-1.5 rounded-lg text-sm transition disabled:opacity-40"
          >
            {batchLoading ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />}
            Apply
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={batchLoading}
            className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold px-3 py-1.5 rounded-lg text-sm transition disabled:opacity-40"
          >
            <Trash2 size={13} />
            Revoke
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="p-1 text-fg/30 hover:text-fg transition"
            aria-label="Clear selection"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* CREATE / EDIT MODAL                                                  */}
      {/* =================================================================== */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md animate-fade-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div>
                <h2 className="font-black text-fg text-lg">
                  {modal.mode === 'create' ? 'New User' : 'Edit User'}
                </h2>
                <p className="text-fg/40 text-xs mt-0.5">
                  {modal.mode === 'create' ? 'Create a new staff account.' : `Editing ${modal.user?.name}`}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-xl text-fg/30 hover:text-fg hover:bg-white/10 transition"
                aria-label="Close modal"
              >
                <X size={17} />
              </button>
            </div>

            <form onSubmit={handleSubmitModal} className="p-6 space-y-4">
              {formErrors.general && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{formErrors.general}</span>
                </div>
              )}

              {/* Name field */}
              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                  Employee Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => handleFormChange('name', e.target.value)}
                  placeholder="e.g. Maria Santos"
                  autoFocus
                  className={`w-full bg-white/5 border text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm
                    ${formErrors.name ? 'border-red-500/60' : 'border-white/10 focus:border-brand'}`}
                />
                {formErrors.name && (
                  <p className="flex items-center gap-1.5 text-red-400 text-xs mt-1.5">
                    <AlertCircle size={11} />{formErrors.name}
                  </p>
                )}
              </div>

              {/* Password field */}
              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                  {modal.mode === 'edit' ? 'New Password (leave blank to keep)' : 'Password / PIN'}
                </label>
                <div className="relative">
                  <input
                    type={form.showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => handleFormChange('password', e.target.value)}
                    placeholder={modal.mode === 'edit' ? '(unchanged)' : 'Min. 4 characters'}
                    className={`w-full bg-white/5 border text-fg placeholder-white/20 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest
                      ${formErrors.password ? 'border-red-500/60' : 'border-white/10 focus:border-brand'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition"
                    aria-label={form.showPassword ? 'Hide password' : 'Show password'}
                  >
                    {form.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {formErrors.password && (
                  <p className="flex items-center gap-1.5 text-red-400 text-xs mt-1.5">
                    <AlertCircle size={11} />{formErrors.password}
                  </p>
                )}
              </div>

              {/* Role field */}
              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                  Access Level
                </label>
                <select
                  value={form.role}
                  onChange={e => handleFormChange('role', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg px-4 py-3 rounded-xl outline-none transition text-sm font-medium"
                >
                  <option className="bg-surface text-fg" value="Staff">Staff (Standard)</option>
                  <option className="bg-surface text-fg" value="Admin">Admin (Manager)</option>
                  {roles.map(r => <option className="bg-surface text-fg" key={r._id} value={r.name}>{r.name}</option>)}
                </select>
              </div>

              {/* Commission rate - edit mode only; a brand-new user has no sales yet */}
              {modal.mode === 'edit' && (
                <div>
                  <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                    Commission Rate (%)
                  </label>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={form.commissionRate}
                    onChange={e => handleFormChange('commissionRate', e.target.value)}
                    placeholder="0"
                    className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                  />
                  <p className="text-[10px] text-fg/30 mt-1.5">Percent of this cashier's attributed sales, shown on the Commissions report.</p>
                </div>
              )}

              {/* Granular permissions - override the role defaults per user */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest">Permissions</label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-fg/50 hover:text-fg/80 text-xs font-bold transition">
                    <input type="checkbox" checked={form.customPerms} onChange={e => handleFormChange('customPerms', e.target.checked)} className="accent-brand" />
                    Customize
                  </label>
                </div>
                {!form.customPerms ? (
                  <p className="text-fg/40 text-xs bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                    Using the default permissions for the <span className="text-brand font-bold">{form.role}</span> access level. Tick “Customize” to set exactly what this person can do.
                  </p>
                ) : (
                  <div className="space-y-3 bg-white/5 border border-white/10 rounded-xl p-3 max-h-60 overflow-y-auto">
                    {groupedPerms.length === 0 && <p className="text-fg/30 text-xs">Loading permissions…</p>}
                    {groupedPerms.map(([group, perms]) => (
                      <div key={group}>
                        <p className="text-[10px] font-black uppercase tracking-wider text-fg/30 mb-1">{group}</p>
                        <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
                          {perms.map(p => (
                            <label key={p.key} className="flex items-center gap-2 text-[13px] text-fg/70 cursor-pointer hover:text-fg transition">
                              <input type="checkbox" checked={form.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} className="accent-brand shrink-0" />
                              <span className="leading-tight">{p.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-3 rounded-xl transition text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading || hasFormErrors}
                  className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {formLoading && <Loader2 size={14} className="animate-spin" />}
                  {formLoading ? 'Saving…' : modal.mode === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CONFIRM DELETE MODAL                                                 */}
      {/* =================================================================== */}
      {confirmDelete.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-sidebar-bg border border-red-500/20 rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Trash2 size={17} className="text-red-400" />
              </div>
              <div>
                <h2 className="font-black text-fg">Remove User?</h2>
                <p className="text-fg/40 text-xs mt-0.5">{confirmDelete.user?.name}</p>
              </div>
            </div>
            <p className="text-fg/40 text-sm mb-6 pl-[52px]">
              This permanently revokes their access and cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete({ open: false, user: null })}
                className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-3 rounded-xl transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={deleteLoading}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold py-3 rounded-xl transition text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deleteLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleteLoading ? 'Removing…' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CLIENT ACCOUNT CREATE / EDIT MODAL                                   */}
      {/* =================================================================== */}
      {clientModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-md animate-fade-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div>
                <h2 className="font-black text-fg text-lg">
                  {clientModal.mode === 'create' ? 'New Client Account' : 'Edit Client'}
                </h2>
                <p className="text-fg/40 text-xs mt-0.5">
                  {clientModal.mode === 'create' ? 'Pre-register a client for logistics ordering.' : `Editing ${clientModal.client?.name}`}
                </p>
              </div>
              <button onClick={closeClientModal} className="p-2 rounded-xl text-fg/30 hover:text-fg hover:bg-white/10 transition" aria-label="Close">
                <X size={17} />
              </button>
            </div>

            <form onSubmit={handleClientSubmit} className="p-6 space-y-4">
              {clientFormError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
                  <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{clientFormError}</span>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Client / Company Name</label>
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Username</label>
                <input
                  type="text"
                  value={clientForm.username}
                  onChange={e => setClientForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. acme_corp"
                  autoComplete="off"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                  {clientModal.mode === 'edit' ? 'New Password (leave blank to keep)' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    type={clientForm.showPassword ? 'text' : 'password'}
                    value={clientForm.password}
                    onChange={e => setClientForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={clientModal.mode === 'edit' ? '(unchanged)' : 'Set a password'}
                    autoComplete="new-password"
                    className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setClientForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/70 transition"
                  >
                    {clientForm.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Default Payment Method</label>
                <select
                  value={clientForm.paymentMethod}
                  onChange={e => setClientForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg px-4 py-3 rounded-xl outline-none text-sm"
                >
                  <option className="bg-surface" value="Cash">Cash on Delivery</option>
                  <option className="bg-surface" value="E-Wallet">E-Wallet</option>
                  <option className="bg-surface" value="Bank Transfer">Bank Transfer</option>
                  <option className="bg-surface" value="Credit Card">Credit Card</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Credit Limit (₱)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={clientForm.creditLimit}
                  onChange={e => setClientForm(f => ({ ...f, creditLimit: e.target.value }))}
                  placeholder="Leave blank for no limit"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm tabular-nums"
                />
                <p className="text-[10px] text-fg/30 mt-1.5 leading-relaxed">
                  Blank = no limit for this client. <span className="text-fg/50 font-bold">0 = cash only</span> (blocks all on-account orders).
                  Whether limits apply at all is set in Settings &rarr; Credit Limits.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Payment Terms (days)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={clientForm.creditTermsDays}
                  onChange={e => setClientForm(f => ({ ...f, creditTermsDays: e.target.value }))}
                  placeholder="e.g. 7, 15, 30"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm tabular-nums"
                />
                <p className="text-[10px] text-fg/30 mt-1.5 leading-relaxed">
                  Days an on-account (utang) sale has before it turns <span className="text-fg/50 font-bold">overdue</span>. Blank = no terms. 0 = due on receipt.
                  Captured onto each order when it completes, so later changes here don&rsquo;t move existing due dates.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">Segments</label>
                <input
                  type="text"
                  value={clientForm.segments}
                  onChange={e => setClientForm(f => ({ ...f, segments: e.target.value }))}
                  placeholder="e.g. wholesale, vip"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                />
                <p className="text-[10px] text-fg/30 mt-1.5 leading-relaxed">
                  Comma-separated tags. A product's Segment Overrides (Products tab) give a
                  special rate to any client tagged with a matching segment.
                </p>
              </div>

              {clientModal.mode === 'edit' && (
                <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  <span className="text-sm font-bold text-fg">Account Active</span>
                  <button
                    type="button"
                    onClick={() => setClientForm(f => ({ ...f, isActive: !f.isActive }))}
                    className={`transition ${clientForm.isActive ? 'text-emerald-400' : 'text-fg/20'}`}
                  >
                    {clientForm.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeClientModal} className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-3 rounded-xl transition text-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={clientFormLoading}
                  className="flex-1 bg-brand hover:bg-brand-dark text-fg font-bold py-3 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {clientFormLoading && <Loader2 size={14} className="animate-spin" />}
                  {clientFormLoading ? 'Saving…' : clientModal.mode === 'create' ? 'Create Client' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* RESET CLIENT PASSWORD MODAL                                          */}
      {/* =================================================================== */}
      {resetPwModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                <KeyRound size={17} className="text-brand" />
              </div>
              <div>
                <h2 className="font-black text-fg">Reset Password</h2>
                <p className="text-fg/40 text-xs mt-0.5">{resetPwModal.client?.name}</p>
              </div>
            </div>

            {resetPwModal.result ? (
              <>
                <p className="text-fg/50 text-sm mb-3">
                  New password for <span className="text-fg font-bold">@{resetPwModal.client?.username}</span> - shown once, write it down now:
                </p>
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4">
                  <span className="flex-1 font-mono text-lg tracking-wide text-fg select-all">{resetPwModal.result}</span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(resetPwModal.result); showToast('Copied.'); }}
                    className="p-2 rounded-lg text-fg/40 hover:text-fg hover:bg-white/10 transition"
                    aria-label="Copy password"
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <p className="text-[10px] text-fg/30 mb-4 leading-relaxed">
                  This password cannot be shown again after you close this - reset again if it's lost.
                </p>
                <button onClick={closeResetPassword} className="w-full bg-brand hover:bg-brand-dark text-fg font-bold py-3 rounded-xl transition shadow-lg shadow-brand/20 text-sm">
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={handleResetPasswordConfirm} className="space-y-4">
                <p className="text-fg/40 text-sm">
                  Passwords are encrypted and can't be viewed - confirm it's you, and a new password
                  will be generated for <span className="text-fg font-bold">@{resetPwModal.client?.username}</span>.
                </p>
                {resetPwModal.error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold px-3 py-2.5 rounded-xl">
                    <AlertCircle size={13} className="flex-shrink-0" /> {resetPwModal.error}
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-fg/50 mb-1.5 block">Your Password</label>
                  <input
                    type="password"
                    autoFocus
                    value={resetPwModal.confirmPassword}
                    onChange={e => setResetPwModal(m => ({ ...m, confirmPassword: e.target.value }))}
                    placeholder="Re-enter your password"
                    className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={closeResetPassword} className="flex-1 bg-white/5 hover:bg-white/10 text-fg/50 hover:text-fg font-bold py-3 rounded-xl transition text-sm">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetPwModal.loading}
                    className="flex-1 bg-brand hover:bg-brand-dark text-fg font-bold py-3 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {resetPwModal.loading && <Loader2 size={14} className="animate-spin" />}
                    {resetPwModal.loading ? 'Resetting…' : 'Reset Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
