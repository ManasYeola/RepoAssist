import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

// Auth
export const getMe = () => api.get('/auth/me');
export const logout = () => api.post('/auth/logout');

// Repositories
export const listRepositories = () => api.get('/repositories');
export const syncRepositories = () => api.post('/repositories/sync');
export const getRepository = (id) => api.get(`/repositories/${id}`);

// Indexing
export const startIndexing = (id) => api.post(`/repositories/${id}/index`);
export const getIndexStatus = (id) => api.get(`/repositories/${id}/index/status`);
export const startReindex = (id, incremental = false) =>
  api.post(`/repositories/${id}/reindex${incremental ? '?incremental=true' : ''}`);

// Chat
export const sendChatMessage = (id, data) => api.post(`/repositories/${id}/chat`, data);
export const getChatSessions = (id) => api.get(`/repositories/${id}/chats`);
export const getChatMessages = (chatId) => api.get(`/chats/${chatId}/messages`);

// Architecture Diagram
export const getArchitectureDiagram = (id, prompt = null) =>
  api.post(`/repositories/${id}/architecture`, { prompt });

// Documentation Generator
export const getRepositoryDocs = (id, prompt = null) =>
  api.post(`/repositories/${id}/docs`, { prompt });

// Repository Summary
export const getRepositorySummary = (id) => api.get(`/repositories/${id}/summary`);
export const regenerateRepositorySummary = (id) =>
  api.post(`/repositories/${id}/summary/regenerate`);

export default api;



