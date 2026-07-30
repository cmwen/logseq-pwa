import { useState } from 'preact/hooks';

export function App() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState('');

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/greet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      setGreeting(data.message);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Template Web App</h1>
      <form onSubmit={handleSubmit}>
        <input
          type='text'
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder='Enter your name'
          style={{ padding: '0.5rem', marginRight: '0.5rem' }}
        />
        <button type='submit' style={{ padding: '0.5rem 1rem' }}>
          Greet
        </button>
      </form>
      {greeting && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f0f0' }}>{greeting}</div>
      )}
    </div>
  );
}
