function getRandomGradient() {
    const gradients = [
        'linear-gradient(45deg, #FF6B6B, #4ECDC4)',
        'linear-gradient(45deg, #A8E6CF, #FFD3B6)',
        'linear-gradient(45deg, #FFAAA5, #FFD3B6)',
        'linear-gradient(45deg, #45B7D1, #A6CFD5)',
        'linear-gradient(45deg, #B19CD9, #FF9DB6)',
        'linear-gradient(45deg, #90AFC5, #336B87)',
        'linear-gradient(45deg, #5C258D, #4389A2)',
        'linear-gradient(45deg, #134E5E, #71B280)'
    ];
    return gradients[Math.floor(Math.random() * gradients.length)];
}

function getInitials(name) {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase();
}

function handleTokenExpiration() {
    // Clear stored auth data
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_password');
    
    // Add expiration message to localStorage
    localStorage.setItem('auth_expired', 'true');
    
    // Redirect to login
    window.location.href = '/login';
}

function checkAndShowExpirationMessage() {
    if (localStorage.getItem('auth_expired')) {
        // Show popup message
        alert('TOKEN EXPIRED!\nUntuk keamanan, anda harus login kembali');
        // Remove the flag
        localStorage.removeItem('auth_expired');
    }
}
