class GestorChat {
    constructor() {
        this.chatActualId = null;
        this.chatActualNombre = null;
        this.ultimoMensajeTiempo = null;
        this.intervaloActualizacion = null;
        this.idUsuarioActual = parseInt(document.body.getAttribute('data-user-id'));
        this.chatActualEsGrupo = false;
        
        // Limpiar sesión al inicio
        this.limpiarSesion();
        
        // Inicializar eventos
        this.inicializarEventos();
        
        // Restaurar chat activo si existe
        const chatGuardadoId = localStorage.getItem('chatActualId');
        if (chatGuardadoId) {
            const chatElemento = document.querySelector(`.chat-item[data-chat-id="${chatGuardadoId}"]`);
            if (chatElemento) {
                this.seleccionarChat(chatElemento);
            }
        }
    }

    async limpiarSesion() {
        try {
            localStorage.removeItem('chatActualId');
            localStorage.removeItem('chatActualNombre');
            await fetch('/clear_active_chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            this.resetearInterfaz();
        } catch (error) {
            console.error('Error clearing chat:', error);
        }
    }
    resetearInterfaz() {
        const messageInput = document.getElementById('messageInput');
        const messagesContainer = document.getElementById('messagesContainer');
        const headerContainer = document.getElementById('chatHeaderInfo');
        
        if (messageInput) messageInput.disabled = true;
        if (headerContainer) headerContainer.innerHTML = this.generarHeaderDefault();
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center text-gray-500">
                    <div class="text-6xl mb-4">💭</div>
                    <p class="text-xl">Selecciona un chat para comenzar</p>
                </div>`;
        }
    }
    
    inicializarEventos() {
        // Eventos de chat
        document.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.seleccionarChat(item);
            });
        });

        // Formulario de mensajes
        const formMensaje = document.getElementById('messageForm');
        if (formMensaje) {
            formMensaje.addEventListener('submit', (e) => this.enviarMensaje(e));
        }
        const busqueda = document.getElementById('busqueda');
        const chatsContainer = document.querySelector('.overflow-y-auto');
    
        if (busqueda) {
            busqueda.addEventListener('input', async () => {
                const searchValue = busqueda.value.trim();
                
                try {
                    const response = await fetch(searchValue === '' 
                        ? '/get_chats'  
                        : `/buscar_chat/${encodeURIComponent(searchValue)}`
                    );
                    console.log('Response:', response);
                    const chats = await response.json();
                    console.log('Chats:', chats);
                    
                    chatsContainer.innerHTML = chats.length === 0
                        ? `<div class="p-4 text-center text-gray-500">
                               No se encontraron chats
                           </div>`
                        : chats.map(chat => `
                            <div class="chat-item flex p-3 hover:bg-gray-100 cursor-pointer border-b" 
                                 data-chat-id="${chat.id}">
                                ${chat.is_group 
                                    ? `<div class="relative w-12 h-12">
                                           <div class="grid grid-cols-2 gap-0.5">
                                               ${chat.group_info.participants.slice(0,4).map(p => 
                                                   `<img src="/static/uploads/${p.avatar || 'default.png'}" 
                                                         class="w-5 h-5 rounded-sm object-cover">`
                                               ).join('')}
                                           </div>
                                           <span class="absolute -bottom-1 -right-1 bg-gray-200 rounded-full text-xs px-1">
                                               ${chat.group_info.participant_count}
                                           </span>
                                       </div>`
                                    : `<div class="relative">
                                           <img src="/static/uploads/${chat.other_user?.avatar || 'default.png'}" 
                                                class="rounded-full w-12 h-12 mr-3">
                                           <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full 
                                               ${chat.other_user?.is_online ? 'bg-green-500' : 'bg-gray-400'}"></span>
                                       </div>`}
                                <div class="flex-1 ml-3">
                                    <div class="flex justify-between">
                                        <h3 class="font-semibold">${chat.name}</h3>
                                        <span class="text-xs text-gray-500">
                                            ${chat.messages?.[0]?.timestamp || ''}
                                        </span>
                                    </div>
                                    ${chat.is_group 
                                        ? `<p class="text-xs text-gray-500">
                                               ${chat.group_info.participant_count} participants
                                           </p>` 
                                        : ''}
                                    <p class="text-sm text-gray-500 truncate">
                                        ${chat.is_group && chat.messages?.[0] 
                                            ? `<span class="font-medium">${chat.messages[0].user_name}:</span> ` 
                                            : ''}
                                        ${chat.messages?.[0]?.content || ''}
                                    </p>
                                </div>
                            </div>`
                        ).join('');
                    
                    chatsContainer.querySelectorAll('.chat-item').forEach(chatElement => {
                        chatElement.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.seleccionarChat(chatElement);
                        });
                    });
                    
                } catch (error) {
                    console.error('Error searching chats:', error);
                    console.error('Chats', chats)
                    chatsContainer.innerHTML = `
                        <div class="p-4 text-center text-text-red-500">
                            Error al buscar chats
                        </div>`;
                }
            });
        }
        // Input de mensajes para manejo de imágenes
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('paste', (e) => this.manejarPegado(e));
        }

        // Otros eventos de UI
        const botonPerfil = document.getElementById('updateProfileBtn');
        if (botonPerfil) {
            botonPerfil.addEventListener('click', () => this.abrirModalPerfil());
        }

        const formNuevoChat = document.getElementById('newChatForm');
        if (formNuevoChat) {
            formNuevoChat.addEventListener('submit', (e) => this.crearNuevoChat(e));
        }

        const botonEliminar = document.getElementById('deleteChatBtn');
        if (botonEliminar) {
            botonEliminar.addEventListener('click', () => this.eliminarChat());
        }

        // Actualizar estado online cada 30 segundos
        setInterval(() => this.actualizarEstado(), 30000);
    }

    async actualizarEstado() {
        try {
            await fetch('/update_status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error('Error updating status:', error);
        }
    }

    async manejarPegado(e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                e.preventDefault();
                const blob = item.getAsFile();
                await this.enviarMensajeConImagen(blob);
                break;
            }
        }
    }
    async actualizarInfoChat(chatId) {
        const headerContainer = document.getElementById('chatHeaderInfo');
        
        if (!chatId) {
            headerContainer.innerHTML = this.generarHeaderDefault();
            return;
        }

        try {
            const response = await fetch(`/get_chat_info/${chatId}`);
            const chatInfo = await response.json();
            console.log('Chat info:', chatInfo);
            console.log('Chat actual es grupo:', chatInfo.is_group);
            
            this.chatActualEsGrupo = chatInfo.is_group;
            
            if (chatInfo.is_group) {
                console.log('GENERANDO HEADER DE GRUPO');
                headerContainer.innerHTML = this.generarHeaderGrupo(chatInfo);
            } else {
                headerContainer.innerHTML = this.generarHeaderIndividual(chatInfo);
            }
        } catch (error) {
            console.error('Error updating chat info:', error);
            headerContainer.innerHTML = this.generarHeaderDefault();
        }
    }


    generarAvatarGrupo(chat) {
        return `
            <div class="relative w-12 h-12">
                <div class="grid grid-cols-2 gap-0.5">
                    ${chat.group_info.participants.slice(0,4).map(p => 
                        `<img src="/static/uploads/${p.avatar || 'default.png'}" 
                              class="w-5 h-5 rounded-sm object-cover">`
                    ).join('')}
                </div>
                <span class="absolute -bottom-1 -right-1 bg-gray-200 rounded-full text-xs px-1">
                    ${chat.group_info.participant_count}
                </span>
            </div>`;
    }
    
    generarAvatarIndividual(chat) {
        return `
            <div class="relative">
                <img src="/static/uploads/${chat.other_user?.avatar || 'default.png'}" 
                     class="rounded-full w-12 h-12 mr-3">
                <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full 
                    ${chat.other_user?.is_online ? 'bg-green-500' : 'bg-gray-400'}"></span>
            </div>`;
    }
    
    formatUltimoMensaje(chat) {
        if (!chat.messages?.[0]) return '';
        
        return chat.is_group 
            ? `<span class="font-medium">${chat.messages[0].user_name}:</span> ${chat.messages[0].content}`
            : chat.messages[0].content;
    }

    generarHeaderDefault() {
        return `
            <div class="flex items-center">
                <div class="w-12 h-12 bg-gray-200 rounded-full mr-3 flex items-center justify-center">
                    <i class="fas fa-comments text-gray-400 text-xl"></i>
                </div>
                <div>
                    <h2 id="currentChatName" class="font-bold">Selecciona un chat</h2>
                    <p id="currentChatStatus" class="text-sm text-gray-600">
                        No hay chat activo
                    </p>
                </div>
            </div>`;
    }

    generarHeaderGrupo(chatInfo) {
        if (!chatInfo || !chatInfo.participants) {
            return this.generarHeaderDefault();
        }

        const participantsList = chatInfo.participants
            .map(p => p.name)
            .join(', ');
            
        return `
            <div class="flex items-center">
                <div class="relative w-12 h-12 mr-3">
                    <div class="grid grid-cols-2 gap-0.5">
                        ${chatInfo.participants.slice(0,4).map(p => 
                            `<img src="/static/uploads/${p.avatar || 'default.png'}" 
                                  alt="${p.name}"
                                  class="w-5 h-5 rounded-sm object-cover">`
                        ).join('')}
                    </div>
                    <span class="absolute -bottom-1 -right-1 bg-gray-200 rounded-full text-xs px-1">
                        ${chatInfo.participant_count}
                    </span>
                </div>
                <div>
                    <h2 id="currentChatName" class="font-bold">${chatInfo.name}</h2>
                    <p id="currentChatStatus" class="text-sm text-gray-600">
                        • ${participantsList}
                    </p>
                </div>
            </div>`;
    }

    generarHeaderIndividual(chatInfo) {
        if (!chatInfo || !chatInfo.other_user) {
            return this.generarHeaderDefault();
        }

        const otherUser = chatInfo.other_user;
        return `
            <div class="flex items-center">
                <div class="relative">
                    <img id="currentChatAvatar" 
                         src="/static/uploads/${otherUser?.avatar || 'default.png'}"
                         alt="${otherUser?.name}"
                         class="w-12 h-12 rounded-full mr-3 object-cover">
                    <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full ${
                        otherUser?.is_online ? 'bg-green-500' : 'bg-gray-400'
                    }"></span>
                </div>
                <div>
                    <h2 id="currentChatName" class="font-bold">${chatInfo.name}</h2>
                    <p id="currentChatStatus" class="text-sm text-gray-600">
                        ${otherUser?.is_online ? 'En línea' : 'Desconectado'}
                    </p>
                </div>
            </div>`;
    }

    async seleccionarChat(elemento) {
        try {
            // Detener actualizaciones previas
            if (this.intervaloActualizacion) {
                clearInterval(this.intervaloActualizacion);
            }

            this.chatActualId = elemento.dataset.chatId;
            this.chatActualNombre = elemento.querySelector('.font-semibold').textContent;
            
            // Actualizar cookies
            localStorage.setItem('chatActualId', this.chatActualId);
            localStorage.setItem('chatActualNombre', this.chatActualNombre);
            
            // Actualizar UI
            document.querySelectorAll('.chat-item').forEach(chat => {
                chat.classList.remove('bg-gray-100');
            });
            elemento.classList.add('bg-gray-100');
            
            // Habilitar input
            const messageInput = document.getElementById('messageInput');
            if (messageInput) messageInput.disabled = false;
            
            // Actualizar información del chat y servidor
            await Promise.all([
                this.actualizarInfoChat(this.chatActualId),
                this.cargarChat(this.chatActualId),
                fetch('/update_active_chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({chat_id: this.chatActualId})
                })
            ]);

            // Iniciar actualizaciones
            this.iniciarActualizacionAutomatica();
        } catch (error) {
            console.error('Error eligiendo el chat:', error);
        }
    }

    async cargarChat(chatId) {
        try {
            const respuesta = await fetch(`/get_chat_messages/${chatId}`);
            const mensajes = await respuesta.json();
            this.actualizarMensajes(mensajes);
        } catch (error) {
            console.error('Error cargando mensajes:', error);
        }
    }
    actualizarMensajes(mensajes) {
        const contenedor = document.getElementById('messagesContainer');
        if (!contenedor) return;

        let html = '';
        let ultimoRemitente = null;
        let ultimaFecha = null;

        mensajes.forEach((msg, index) => {
            const esMiMensaje = msg.user_id === this.idUsuarioActual;
            const mostrarNombre = this.chatActualEsGrupo && !esMiMensaje && msg.user_id !== ultimoRemitente;
            
            // Verificar si es un nuevo día
            const fechaMensaje = new Date(msg.timestamp).toLocaleDateString();
            if (fechaMensaje !== ultimaFecha) {
                html += `
                    <div class="flex justify-center my-4">
                        <span class="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
                            ${fechaMensaje}
                        </span>
                    </div>`;
                ultimaFecha = fechaMensaje;
            }
            
            html += this.generarMensajeHTML(msg, esMiMensaje, mostrarNombre);
            
            ultimoRemitente = msg.user_id;
        });

        contenedor.innerHTML = html;
        contenedor.scrollTop = contenedor.scrollHeight;
    
}
    generarMensajeHTML(msg, esMiMensaje, mostrarNombre) {
        const esImagen = msg.content.startsWith('/static/uploads/');
        const contenido = esImagen ? 
            `<img src="${msg.content}" class="max-w-xs rounded-lg cursor-pointer hover:opacity-90" onclick="window.open(this.src)">` :
            `<p>${msg.content}</p>`;

        const mensajeClases = esMiMensaje ? 
            'bg-green-100 ml-auto' : 
            'bg-white';
        console.log('Mensaje:', msg.user_avatar);

        return `
            <div class="flex my-2 ${esMiMensaje ? 'justify-end' : 'justify-start'}">
                ${!esMiMensaje ? `
                    <img src="/static/uploads/${msg.user_avatar || 'default.png'}" 
                         alt="${msg.user_name}" 
                         class="w-8 h-8 rounded-full mr-2 self-end">
                ` : ''}
                <div class="${mensajeClases} p-2 rounded-lg max-w-md">
                    ${mostrarNombre ? `
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-semibold text-sm text-gray-700">${msg.user_name}</span>
                        </div>
                    ` : ''}
                    ${contenido}
                    <span class="text-xs text-gray-500 block text-right">
                        ${new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                </div>
            </div>`;
    }
    async enviarMensaje(e) {
        e.preventDefault();
        if (!this.chatActualId) return;

        const input = document.getElementById('messageInput');
        const contenido = input.value.trim();
        
        if (!contenido) return;

        try {
            const respuesta = await fetch('/send_message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: this.chatActualId,
                    content: contenido
                })
            });

            if (respuesta.ok) {
                input.value = '';
                await this.cargarChat(this.chatActualId);
            }
        } catch (error) {
            console.error('Error mandando mensaje:', error);
        }
    }

    async enviarMensajeConImagen(blob) {
        if (!this.chatActualId) return;

        const formData = new FormData();
        formData.append('image', blob);
        formData.append('chat_id', this.chatActualId);

        try {
            const response = await fetch('/mensaje_con_imagen', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                await this.cargarChat(this.chatActualId);
            }
        } catch (error) {
            console.error('Error mandando imagen:', error);
        }
    }

    iniciarActualizacionAutomatica() {
        if (this.intervaloActualizacion) {
            clearInterval(this.intervaloActualizacion);
        }
        
        this.intervaloActualizacion = setInterval(async () => {
            if (this.chatActualId) {
                try {
                    const [mensajesResponse, infoResponse] = await Promise.all([
                        fetch(`/get_chat_messages/${this.chatActualId}`),
                        fetch(`/get_chat_info/${this.chatActualId}`)
                    ]);
                    
                    const mensajes = await mensajesResponse.json();
                    const chatInfo = await infoResponse.json();
                    
                    // Actualizar mensajes solo si hay nuevos
                    if (mensajes.length > 0) {
                        const ultimoMensaje = mensajes[mensajes.length - 1];
                        if (!this.ultimoMensajeTiempo || 
                            new Date(ultimoMensaje.timestamp) > new Date(this.ultimoMensajeTiempo)) {
                            this.actualizarMensajes(mensajes);
                            this.ultimoMensajeTiempo = ultimoMensaje.timestamp;
                            
                            if (ultimoMensaje.user_id !== this.idUsuarioActual) {
                                this.mostrarNotificacion(ultimoMensaje);
                            }
                        }
                    }
                    
                    // Actualizar información del chat
                    if (chatInfo.is_group) {
                        document.getElementById('chatHeaderInfo').innerHTML = 
                            this.generarHeaderGrupo(chatInfo);
                    } else {
                        document.getElementById('chatHeaderInfo').innerHTML = 
                            this.generarHeaderIndividual(chatInfo);
                    }
                } catch (error) {
                    console.error('Error en actualización:', error);
                }
            }
        }, 3000);
    }

    async mostrarNotificacion(mensaje) {
        if (!("Notification" in window)) return;
        
        if (Notification.permission === "granted") {
            new Notification(this.chatActualNombre, {
                body: mensaje.content.startsWith('/static/uploads/') ? 
                    '📷 Nueva imagen' : mensaje.content,
                icon: "/static/uploads/default.png"
            });
        }
    }

    async cargarUsuarios() {
        try {
            const respuesta = await fetch('/get_users');
            if (respuesta.ok) {
                const usuarios = await respuesta.json();
                const select = document.getElementById('userId');
                
                // Limpiar opciones existentes manteniendo la primera
                while (select.options.length > 1) {
                    select.remove(1);
                }
                
                // Agregar usuarios
                usuarios.forEach(usuario => {
                    const opcion = document.createElement('option');
                    opcion.value = usuario.id;
                    opcion.textContent = usuario.name;
                    select.appendChild(opcion);
                });
            }
        } catch (error) {
            console.error('Error cargando usuarios:', error);
        }
    }

    async crearNuevoChat(e) {
        e.preventDefault();
        const nombre = document.getElementById('chatName').value.trim();
        const select = document.getElementById('userId');
        const usuariosSeleccionados = Array.from(select.selectedOptions).map(option => parseInt(option.value));
    
        if (!nombre || usuariosSeleccionados.length === 0) {
            alert('Por favor, completa todos los campos');
            return;
        }
    
        try {
            const respuesta = await fetch('/create_chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: nombre,
                    participants: usuariosSeleccionados,
                    is_group: usuariosSeleccionados.length > 1
                })
            });
    
            if (respuesta.ok) {
                this.cerrarModalNuevoChat();
                window.location.reload();
            } else {
                const error = await respuesta.json();
                alert(error.message || 'Error al crear el chat');
            }
        } catch (error) {
            console.error('Error creando el chat:', error);
            alert('Error al crear el chat');
        }
    }

    async eliminarChat() {
        if (!this.chatActualId) return;
        
        if (!confirm('¿Estás seguro de que quieres eliminar este chat?')) return;

        try {
            const respuesta = await fetch(`/delete_chat/${this.chatActualId}`, {
                method: 'POST'
            });

            if (respuesta.ok) {
                // Limpiar el chat actual antes de recargar
                await this.limpiarSesion();
                window.location.reload();
            } else {
                const error = await respuesta.json();
                alert(error.message || 'Error al eliminar el chat');
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
            alert('Error al eliminar el chat');
        }
    }

    // Métodos de gestión de modal
    abrirModalPerfil() {
        const modal = document.getElementById('profileModal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    cerrarModalPerfil() {
        const modal = document.getElementById('profileModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    async abrirModalNuevoChat() {
        const modal = document.getElementById('newChatModal');
        if (modal) {
            modal.classList.remove('hidden');
            await this.cargarUsuarios();
        }
    }

    cerrarModalNuevoChat() {
        const modal = document.getElementById('newChatModal');
        if (modal) {
            modal.classList.add('hidden');
            // Limpiar campos
            document.getElementById('chatName').value = '';
            document.getElementById('userId').selectedIndex = 0;
        }
    }
}

// Inicialización y funciones globales
document.addEventListener('DOMContentLoaded', () => {
    window.gestorChat = new GestorChat();
});

// Funciones globales para los modales
window.openNewChatModal = () => {
    if (window.gestorChat) {
        window.gestorChat.abrirModalNuevoChat();
    }
};

window.closeNewChatModal = () => {
    if (window.gestorChat) {
        window.gestorChat.cerrarModalNuevoChat();
    }
};

window.closeProfileModal = () => {
    if (window.gestorChat) {
        window.gestorChat.cerrarModalPerfil();
    }
};