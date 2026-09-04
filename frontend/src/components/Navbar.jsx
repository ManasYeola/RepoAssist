import { logout } from '../api';
import { useNavigate } from 'react-router-dom';

const Navbar = ({ user, onLogout }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      onLogout();
      navigate('/');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-logo" onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#ng)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="ng" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1"/>
                <stop offset="100%" stopColor="#8b5cf6"/>
              </linearGradient>
            </defs>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          RepoGPT
        </div>

        <div className="navbar-user">
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {user.githubLogin && `@${user.githubLogin}`}
          </span>
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt={user.name} className="avatar" />
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
