function updateStatus() {
    fetch('/update_status', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include'  // Importante para incluir las cookies de sesión
    })
    .then(response => response.json())
    .catch(error => console.error('Error:', error));
}

// Actualizar estado cada 30 segundos
setInterval(updateStatus, 30000);

// Actualizar estado cuando la página está activa
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        updateStatus();
    }
});

// Actualizar estado en eventos de usuario
['click', 'keypress', 'mousemove', 'touchstart'].forEach(event => {
    document.addEventListener(event, _.debounce(updateStatus, 1000));
});

// Actualizar estado antes de cerrar la página
window.addEventListener('beforeunload', function() {
    navigator.sendBeacon('/logout');
});
