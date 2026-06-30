import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as auth from '../lib/auth';
import {
  Users, Shield, Menu, X, LogOut, Plus, Edit2, Trash2,
  Search, Eye, EyeOff, AlertCircle, Tag, Loader2, Lock,
  ChevronRight, UserCheck, Monitor, Check, Package, ToggleLeft, ToggleRight
} from 'lucide-react';

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';

const ROLE_META = {
  superadmin: { label: 'Superadmin', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Admin:      { label: 'Admin',      bg: 'bg-blue-500/20',    text: 'text-blue-400',    border: 'border-blue-500/30' },
  Staff:      { label: 'Staff',      bg: 'bg-gray-500/20',    text: 'text-gray-400',    border: 'border-gray-500/30' },
};
const getRoleMeta = (role) =>
  ROLE_META[role] ?? { label: role, bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' };

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
            ? 'bg-brand border-brand' : 'border-white/20 hover:border-brand'}`}
        aria-label={isSelected ? 'Deselect' : 'Select'}
      >
        {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
      </button>

      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${meta.bg} ${meta.text}`}>
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-white truncate">{user.name}</p>
        <p className="text-xs text-white/40 font-mono">{user.userCode}</p>
      </div>

      <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border flex-shrink-0
        ${meta.bg} ${meta.text} ${meta.border}`}>
        {meta.label}
      </span>

      {!isProtected ? (
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => onEdit(user)}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition"
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
        <Lock size={13} className="text-white/20 flex-shrink-0" />
      )}
    </div>
  );
});
UserCard.displayName = 'UserCard';

const NAV_ITEMS = [
  { id: 'users', label: 'User Control',  icon: Users },
  { id: 'roles', label: 'Access Roles',  icon: Tag },
  { id: 'clients', label: 'Client Accounts', icon: Package },
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
            <p className="font-black text-white text-xs uppercase tracking-widest leading-none">Command</p>
            <p className="font-black text-brand text-xs uppercase tracking-widest leading-none mt-0.5">Center</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded text-white/30 hover:text-white transition" aria-label="Close menu">
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
              ${activeSection === id ? 'bg-brand/20 text-brand' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
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
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition font-bold text-sm"
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

const EMPTY_FORM = { name: '', password: '', role: 'Staff', showPassword: false };

export default function SuperAdminPanel() {
  const navigate = useNavigate();

  // Auth — access token lives in memory; restored via silent refresh on mount.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    auth.refreshSession(API_URL).then((data) => {
      if (cancelled) return;
      // This panel is superadmin-only — only authenticate if the role matches.
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

  // Roles form
  const [newRole, setNewRole]       = useState('');
  const [roleLoading, setRoleLoading] = useState(false);

  // Client accounts (logistics mode)
  const [clients, setClients]           = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientModal, setClientModal]   = useState({ open: false, mode: 'create', client: null });
  const [clientForm, setClientForm]     = useState({ username: '', password: '', name: '', paymentMethod: 'Cash', isActive: true, showPassword: false });
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

  useEffect(() => {
    if (isAuthenticated) { fetchUsers(); fetchRoles(); }
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
        setLoginError('Invalid name or password.');
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
    setForm({ name: user.name, password: '', role: user.role, showPassword: false });
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

  const handleSubmitModal = async (e) => {
    e.preventDefault();
    const errors = validateForm(form, modal.mode, modal.user);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setFormLoading(true);
    try {
      if (modal.mode === 'create') {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ name: form.name.trim(), password: form.password, role: form.role }),
        });
        const data = await res.json();
        if (data.success) { showToast('User created.'); closeModal(); fetchUsers(); }
        else setFormErrors({ general: data.error || 'Failed to create user.' });
      } else {
        const body = { name: form.name.trim(), role: form.role };
        if (form.password) body.password = form.password;
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
  const handleAddRole = async (e) => {
    e.preventDefault();
    if (!newRole.trim()) return;
    setRoleLoading(true);
    try {
      await apiFetch('/api/roles', { method: 'POST', body: JSON.stringify({ name: newRole.trim() }) });
      setNewRole(''); fetchRoles(); showToast('Role added.');
    } finally { setRoleLoading(false); }
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
    setClientForm({ username: '', password: '', name: '', paymentMethod: 'Cash', isActive: true, showPassword: false });
    setClientFormError('');
    setClientModal({ open: true, mode: 'create', client: null });
  };

  const openClientEdit = (client) => {
    setClientForm({ username: client.username, password: '', name: client.name, paymentMethod: client.paymentMethod, isActive: client.isActive, showPassword: false });
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
    try {
      if (clientModal.mode === 'create') {
        const res = await apiFetch('/api/client-accounts', {
          method: 'POST',
          body: JSON.stringify({ username: clientForm.username.trim(), password: clientForm.password, name: clientForm.name.trim(), paymentMethod: clientForm.paymentMethod }),
        });
        const data = await res.json();
        if (data.success) { showToast('Client account created.'); closeClientModal(); fetchClients(); }
        else setClientFormError(data.error || 'Failed to create client.');
      } else {
        const body = { name: clientForm.name.trim(), paymentMethod: clientForm.paymentMethod, isActive: clientForm.isActive };
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
      <div className="min-h-screen bg-page-bg flex items-center justify-center text-white/60 text-sm">
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
            <h2 className="text-xl font-black text-white uppercase tracking-widest">Command Center</h2>
            <p className="text-white/40 text-xs mt-1">Superadmin credentials required</p>
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
              className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/30 px-4 py-3 rounded-xl outline-none transition text-sm font-medium"
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
                className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/30 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest"
                required
              />
              <button
                type="button"
                onClick={() => setLoginForm(f => ({ ...f, showPassword: !f.showPassword }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
                aria-label={loginForm.showPassword ? 'Hide password' : 'Show password'}
              >
                {loginForm.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loginLoading}
            className="w-full bg-brand hover:bg-brand-dark text-white font-black py-3 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loginLoading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
            {loginLoading ? 'Authenticating…' : 'Authenticate'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="w-full text-white/30 hover:text-white/60 text-xs font-bold uppercase tracking-widest transition mt-4"
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
    <div className="min-h-screen bg-page-bg flex text-white">

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
            className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={21} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-black text-white text-sm uppercase tracking-widest truncate">Command Center</p>
            <p className="text-brand text-[10px] font-bold uppercase tracking-[0.15em] truncate">
              Management &rsaquo; {sectionLabel}
            </p>
          </div>
        </header>

        {/* Sticky section header */}
        <div className="sticky top-0 z-20 bg-page-bg/90 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-white/30 text-[10px] font-bold uppercase tracking-[0.2em]">
              Management &rsaquo; {sectionLabel}
            </p>
            <h1 className="text-xl font-black text-white mt-0.5">{sectionLabel}</h1>
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
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold px-4 py-2.5 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex-shrink-0"
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
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder="Search name, code, or role…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/30
                    pl-10 pr-4 py-2.5 rounded-xl outline-none transition text-sm"
                />
              </div>
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className="bg-white/5 border border-white/10 focus:border-brand text-white px-4 py-2.5 rounded-xl outline-none text-sm font-medium"
              >
                <option className="bg-[#1a1a1a] text-white" value="All">All Roles</option>
                <option className="bg-[#1a1a1a] text-white" value="superadmin">Superadmin</option>
                <option className="bg-[#1a1a1a] text-white" value="Admin">Admin</option>
                <option className="bg-[#1a1a1a] text-white" value="Staff">Staff</option>
                {roles.map(r => <option className="bg-[#1a1a1a] text-white" key={r._id} value={r.name}>{r.name}</option>)}
              </select>
            </div>

            {/* Select-all row */}
            {!loading && filteredUsers.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-2 text-xs font-bold text-white/40 hover:text-white transition uppercase tracking-wider"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition
                    ${allSelected ? 'bg-brand border-brand' : 'border-white/20'}`}>
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
                      <Users size={40} className="text-white/10 mb-4" />
                      <p className="text-white/40 font-bold text-sm mb-1">
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
                    <Package size={40} className="text-white/10 mb-4" />
                    <p className="text-white/40 font-bold text-sm">No client accounts yet.</p>
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
                      <p className="font-bold text-white truncate">{client.name}</p>
                      <p className="text-xs text-white/40 font-mono">{client.clientCode} · @{client.username}</p>
                    </div>
                    <span className="text-[10px] font-bold text-white/50 bg-white/10 px-2 py-1 rounded-full flex-shrink-0">
                      {client.paymentMethod}
                    </span>
                    <button
                      onClick={() => toggleClientActive(client)}
                      className={`flex-shrink-0 transition ${client.isActive ? 'text-emerald-400' : 'text-white/20'}`}
                      title={client.isActive ? 'Active - click to deactivate' : 'Inactive - click to activate'}
                    >
                      {client.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openClientEdit(client)} className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition" aria-label="Edit">
                        <Edit2 size={14} />
                      </button>
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
          <div className="flex-1 p-6 max-w-lg">
            <form onSubmit={handleAddRole} className="flex gap-3 mb-6">
              <input
                type="text"
                placeholder="New role name (e.g. Barista, Kitchen)"
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/30 px-4 py-2.5 rounded-xl outline-none transition text-sm"
              />
              <button
                type="submit"
                disabled={roleLoading || !newRole.trim()}
                className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50 text-sm"
              >
                {roleLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add
              </button>
            </form>

            <div className="space-y-2">
              {roles.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-center">
                  <Tag size={32} className="text-white/10 mb-3" />
                  <p className="text-white/40 font-bold text-sm">No custom roles yet.</p>
                  <p className="text-white/20 text-xs mt-1">Staff and Admin are built-in.</p>
                </div>
              ) : roles.map(r => (
                <div
                  key={r._id}
                  className="flex items-center justify-between bg-white/5 hover:bg-white/[0.07] border border-white/5 px-5 py-4 rounded-xl transition"
                >
                  <div className="flex items-center gap-3">
                    <Tag size={13} className="text-brand" />
                    <span className="font-bold text-white text-sm">{r.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteRole(r._id, r.name)}
                    className="p-1.5 rounded-lg text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition"
                    aria-label={`Delete ${r.name} role`}
                  >
                    <Trash2 size={14} />
                  </button>
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3
          bg-[#1f1f1f] border border-white/15 shadow-2xl px-5 py-3 rounded-2xl animate-fade-in">
          <span className="text-white/50 text-sm font-bold whitespace-nowrap">{selected.size} selected</span>
          <div className="w-px h-5 bg-white/10 flex-shrink-0" />
          <select
            value={batchRole}
            onChange={e => setBatchRole(e.target.value)}
            className="bg-white/10 border border-white/10 text-white text-sm px-3 py-1.5 rounded-lg outline-none"
          >
            <option className="bg-[#1a1a1a] text-white" value="">Change role…</option>
            <option className="bg-[#1a1a1a] text-white" value="Admin">Admin</option>
            <option className="bg-[#1a1a1a] text-white" value="Staff">Staff</option>
            {roles.map(r => <option className="bg-[#1a1a1a] text-white" key={r._id} value={r.name}>{r.name}</option>)}
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
            className="p-1 text-white/30 hover:text-white transition"
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
                <h2 className="font-black text-white text-lg">
                  {modal.mode === 'create' ? 'New User' : 'Edit User'}
                </h2>
                <p className="text-white/40 text-xs mt-0.5">
                  {modal.mode === 'create' ? 'Create a new staff account.' : `Editing ${modal.user?.name}`}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition"
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
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">
                  Employee Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => handleFormChange('name', e.target.value)}
                  placeholder="e.g. Maria Santos"
                  autoFocus
                  className={`w-full bg-white/5 border text-white placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm
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
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">
                  {modal.mode === 'edit' ? 'New Password (leave blank to keep)' : 'Password / PIN'}
                </label>
                <div className="relative">
                  <input
                    type={form.showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => handleFormChange('password', e.target.value)}
                    placeholder={modal.mode === 'edit' ? '(unchanged)' : 'Min. 4 characters'}
                    className={`w-full bg-white/5 border text-white placeholder-white/20 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest
                      ${formErrors.password ? 'border-red-500/60' : 'border-white/10 focus:border-brand'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
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
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">
                  Access Level
                </label>
                <select
                  value={form.role}
                  onChange={e => handleFormChange('role', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-white px-4 py-3 rounded-xl outline-none transition text-sm font-medium"
                >
                  <option className="bg-[#1a1a1a] text-white" value="Staff">Staff (Standard)</option>
                  <option className="bg-[#1a1a1a] text-white" value="Admin">Admin (Manager)</option>
                  {roles.map(r => <option className="bg-[#1a1a1a] text-white" key={r._id} value={r.name}>{r.name}</option>)}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white font-bold py-3 rounded-xl transition text-sm"
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
                <h2 className="font-black text-white">Remove User?</h2>
                <p className="text-white/40 text-xs mt-0.5">{confirmDelete.user?.name}</p>
              </div>
            </div>
            <p className="text-white/40 text-sm mb-6 pl-[52px]">
              This permanently revokes their access and cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete({ open: false, user: null })}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white font-bold py-3 rounded-xl transition text-sm"
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
                <h2 className="font-black text-white text-lg">
                  {clientModal.mode === 'create' ? 'New Client Account' : 'Edit Client'}
                </h2>
                <p className="text-white/40 text-xs mt-0.5">
                  {clientModal.mode === 'create' ? 'Pre-register a client for logistics ordering.' : `Editing ${clientModal.client?.name}`}
                </p>
              </div>
              <button onClick={closeClientModal} className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition" aria-label="Close">
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
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">Client / Company Name</label>
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">Username</label>
                <input
                  type="text"
                  value={clientForm.username}
                  onChange={e => setClientForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. acme_corp"
                  autoComplete="off"
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">
                  {clientModal.mode === 'edit' ? 'New Password (leave blank to keep)' : 'Password'}
                </label>
                <div className="relative">
                  <input
                    type={clientForm.showPassword ? 'text' : 'password'}
                    value={clientForm.password}
                    onChange={e => setClientForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={clientModal.mode === 'edit' ? '(unchanged)' : 'Set a password'}
                    autoComplete="new-password"
                    className="w-full bg-white/5 border border-white/10 focus:border-brand text-white placeholder-white/20 px-4 py-3 pr-12 rounded-xl outline-none transition text-sm tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setClientForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
                  >
                    {clientForm.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1.5">Default Payment Method</label>
                <select
                  value={clientForm.paymentMethod}
                  onChange={e => setClientForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 focus:border-brand text-white px-4 py-3 rounded-xl outline-none text-sm"
                >
                  <option className="bg-[#1a1a1a]" value="Cash">Cash on Delivery</option>
                  <option className="bg-[#1a1a1a]" value="E-Wallet">E-Wallet</option>
                  <option className="bg-[#1a1a1a]" value="Bank Transfer">Bank Transfer</option>
                  <option className="bg-[#1a1a1a]" value="Credit Card">Credit Card</option>
                </select>
              </div>

              {clientModal.mode === 'edit' && (
                <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  <span className="text-sm font-bold text-white">Account Active</span>
                  <button
                    type="button"
                    onClick={() => setClientForm(f => ({ ...f, isActive: !f.isActive }))}
                    className={`transition ${clientForm.isActive ? 'text-emerald-400' : 'text-white/20'}`}
                  >
                    {clientForm.isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeClientModal} className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white font-bold py-3 rounded-xl transition text-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={clientFormLoading}
                  className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-xl transition shadow-lg shadow-brand/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {clientFormLoading && <Loader2 size={14} className="animate-spin" />}
                  {clientFormLoading ? 'Saving…' : clientModal.mode === 'create' ? 'Create Client' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
