from flask import Flask, request, jsonify, render_template, redirect, session
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta
import dotenv
from apscheduler.schedulers.background import BackgroundScheduler
import os
import time 

dotenv.load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv('key')  
app.config['UPLOAD_FOLDER'] = 'static/uploads'
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat_app.db'
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(100), nullable=False)
    messages = db.relationship('Message', backref='user', lazy=True)
    last_seen = db.Column(db.DateTime, default=datetime.now)
    is_online = db.Column(db.Boolean, default=False)
    avatar = db.Column(db.String(255), nullable=True)  
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'avatar': self.avatar,
            'is_online': self.is_online,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None
        }


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.now)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'), nullable=False)
    is_image = db.Column(db.Boolean, default=False)

class Chat(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    is_group = db.Column(db.Boolean, default=False)
    messages = db.relationship('Message', backref='chat', lazy=True)
    participants = db.relationship('ChatParticipant', backref='chat', lazy=True)
    @property
    def other_user(self):
        participant = ChatParticipant.query.filter(
            ChatParticipant.chat_id == self.id,
            ChatParticipant.user_id != session['user_id']
        ).first()
        if participant:
            return User.query.get(participant.user_id)
        return None
    @property
    def group_info(self):
        if self.is_group:
            participants = User.query.join(ChatParticipant).filter(
                ChatParticipant.chat_id == self.id
            ).all()
            return {
                'participants': [participant.to_dict() for participant in participants],
                'participant_count': len(participants)
            }
        return None


class ChatParticipant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'), nullable=False)
    user = db.relationship('User', backref='chat_participation')

class ChatDelete(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    chat_id = db.Column(db.Integer, db.ForeignKey('chat.id'))
    deleted_at = db.Column(db.DateTime, default=datetime.utcnow)

@app.route('/update_status', methods=['POST'])
def update_status():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user = User.query.get(session['user_id'])
    user.is_online = True
    user.last_seen = datetime.now()
    db.session.commit()
    return jsonify({'status': 'updated'})


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        data = request.json
        if not data:
            data = {
                'name': request.form.get('name'),
                'email': request.form.get('email'),
                'password': request.form.get('password'),
            }
        if not data['name'] or not data['email'] or not data['password']:
            return jsonify({'error': 'Fallo al registrar'}), 400
        
        existing_email = User.query.filter_by(email=data['email']).first()
        existing_name = User.query.filter_by(name=data['name']).first()
        if existing_email or existing_name:
            return jsonify({'error': 'User already exists'}), 400
        
        hashed_password = generate_password_hash(data['password'])
        new_user = User(
            name=data['name'], 
            email=data['email'], 
            password=hashed_password,
            last_seen=datetime.now(),
        )
        db.session.add(new_user)
        db.session.commit()
        
        return jsonify({
            'id': new_user.id, 
            'name': new_user.name, 
            'email': new_user.email,
            'last_seen': new_user.last_seen
        }), 201
    elif request.method == 'GET':
        return render_template('register.html')
 

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        data = request.json
        user = User.query.filter_by(email=data['email']).first()
        
        if user and check_password_hash(user.password, data['password']):
            session['user_id'] = user.id
            return jsonify({
                'id': user.id, 
                'name': user.name, 
                'email': user.email
            })
        return jsonify({'error': 'Fallo al iniciar sesion'}), 401
    elif request.method == 'GET':
        return render_template('login.html')




@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect('/login')

@app.route('/create_chat', methods=['POST'])
def create_chat():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.json
    new_chat = Chat(
        name=data.get('name', 'New Chat'), 
        is_group=data.get('is_group', False)
    )
    db.session.add(new_chat)
    
    db.session.add(ChatParticipant(
        user_id=session['user_id'],
        chat=new_chat
    ))
    
    if data.get('participants'):
        for user_id in data['participants']:
            if user_id != session['user_id']:  
                db.session.add(ChatParticipant(
                    user_id=user_id,
                    chat=new_chat
                ))
    
    db.session.commit()
    return jsonify({
        'id': new_chat.id,
        'name': new_chat.name,
        'is_group': new_chat.is_group
    })

@app.route('/send_message', methods=['POST'])
def send_message():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.json
    chat = Chat.query.get(data['chat_id'])

    if not chat:
        return jsonify({'error': 'Chat not found'}), 404

    new_message = Message(
        content=data['content'],
        user_id=session['user_id'],
        chat_id=chat.id
    )
    db.session.add(new_message)

    db.session.commit()

    return jsonify({
        'id': new_message.id,
        'content': new_message.content,
        'user_id': new_message.user_id,
        'timestamp': new_message.timestamp,
        'user_name': User.query.get(new_message.user_id).name
    })

@app.route('/mensaje_con_imagen', methods=['POST'])
def send_message_with_image():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
        
    file = request.files['image']
    chat_id = request.form.get('chat_id')
    
    if file:
        filename = secure_filename(f"{int(time.time())}_{file.filename}")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        
        new_message = Message(
            content=f'/static/uploads/{filename}',
            user_id=session['user_id'],
            chat_id=chat_id,
            timestamp=datetime.now(),
            is_image=True
        )
        
        db.session.add(new_message)
        db.session.commit()
        
        return jsonify({
            'id': new_message.id,
            'image_url': new_message.content,
            'timestamp': new_message.timestamp
        })

def get_user_chats():
    return Chat.query.join(ChatParticipant)\
        .filter(ChatParticipant.user_id == session['user_id'])\
        .filter(~Chat.id.in_(
            db.session.query(ChatDelete.chat_id)
            .filter(ChatDelete.user_id == session['user_id'])
        ))\
        .all()

@app.route('/get_chat_messages/<int:chat_id>')
def get_chat_messages(chat_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    participant = ChatParticipant.query.filter_by(
        user_id=session['user_id'], 
        chat_id=chat_id
    ).first()
    if not participant:
        return jsonify({'error': 'Not a chat participant'}), 403
    
    messages = Message.query.filter_by(chat_id=chat_id).order_by(Message.timestamp).all()
    return jsonify([{
        'id': msg.id,
        'content': msg.content,
        'user_id': msg.user_id,
        'timestamp': msg.timestamp,
        'user_avatar': User.query.get(msg.user_id).avatar,
        'user_name': User.query.get(msg.user_id).name,
    } for msg in messages])

@app.route('/delete_chat/<int:chat_id>', methods=['POST'])
def delete_chat(chat_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    participant = ChatParticipant.query.filter_by(
        user_id=session['user_id'], 
        chat_id=chat_id
    ).first()
    
    if not participant:
        return jsonify({'error': 'Not a chat participant'}), 403
    
    delete_entry = ChatDelete(
        user_id=session['user_id'],
        chat_id=chat_id
    )
    db.session.add(delete_entry)
    db.session.commit()
    
    return jsonify({'message': 'Chat deleted for you'})

@app.route('/')
def home():
    if 'user_id' not in session:
        return redirect('/login')
    user = User.query.get(session['user_id'])
    
    user_chats = get_user_chats()
    
    active_chat = None
    active_chat_id = session.get('active_chat_id')
    if active_chat_id:
        active_chat = Chat.query.get(active_chat_id)
    
    messages = []
    if active_chat:
        messages = Message.query.filter_by(chat_id=active_chat.id).order_by(Message.timestamp).all()
    
    return render_template('index.html', 
                         user=user, 
                         chats=user_chats, 
                         messages=messages,
                         active_chat=active_chat)


@app.route('/update_active_chat', methods=['POST'])
def update_active_chat():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.json
    session['active_chat_id'] = data['chat_id']
    return jsonify({'status': 'updated'})

@app.route('/subir_imagen', methods=['POST'])
def subir_imagen():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    filename = secure_filename(file.filename)
    file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))

    user = User.query.get(session['user_id'])
    if user:
        user.avatar = filename
        db.session.commit()

    return redirect('/')

@app.route('/buscar_chat/<string:nombre>')
def buscar_chat(nombre):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    chats = Chat.query.join(ChatParticipant)\
        .filter(ChatParticipant.user_id == session['user_id'])\
        .filter(Chat.name.ilike(f'%{nombre}%'))\
        .filter(~Chat.id.in_(
            db.session.query(ChatDelete.chat_id)
            .filter(ChatDelete.user_id == session['user_id'])
        ))\
        .all()
    
    return jsonify([{
        'id': chat.id,
        'name': chat.name,
        'is_group': chat.is_group,
        'group_info': chat.group_info if chat.is_group else None,
        'other_user': {
            'avatar': chat.other_user.avatar if chat.other_user else None,
            'is_online': chat.other_user.is_online if chat.other_user else None,
            'name': chat.other_user.name if chat.other_user else None
        } if not chat.is_group else None,
        'messages': [{
            'content': msg.content,
            'timestamp': msg.timestamp.strftime('%H:%M'),
            'user_name': msg.user.name
        } for msg in chat.messages[-1:]] if chat.messages else []
    } for chat in chats])

@app.route('/get_chats')
def get_chats():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        chats = Chat.query.join(ChatParticipant)\
            .filter(ChatParticipant.user_id == session['user_id'])\
            .filter(~Chat.id.in_(
                db.session.query(ChatDelete.chat_id)
                .filter(ChatDelete.user_id == session['user_id'])
            ))\
            .all()
        
        chat_list = []
        for chat in chats:
            other_user = chat.other_user.to_dict() if not chat.is_group and chat.other_user else None
            
            last_message = Message.query.filter_by(chat_id=chat.id)\
                .order_by(Message.timestamp.desc())\
                .first()
            
            chat_data = {
                'id': chat.id,
                'name': chat.name,
                'is_group': chat.is_group,
                'group_info': chat.group_info if chat.is_group else None,
                'other_user': other_user,
                'messages': [{
                    'content': last_message.content,
                    'timestamp': last_message.timestamp.strftime('%H:%M'),
                    'user_name': last_message.user.name
                }] if last_message else []
            }
            chat_list.append(chat_data)
        
        return jsonify(chat_list)
    
    except Exception as e:
        print(f"Error in get_chats: {e}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/clear_active_chat', methods=['POST'])
def clear_active_chat():
    if 'active_chat_id' in session:
        session.pop('active_chat_id')
    return jsonify({'status': 'cleared'})

@app.route('/get_users')
def get_users():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Obtiene todos los usuarios excepto el usuario actual
    users = User.query.filter(User.id != session['user_id']).all()
    return jsonify([{
        'id': user.id,
        'name': user.name
    } for user in users])

@app.route('/get_chat_info/<int:chat_id>')
def get_chat_info(chat_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        chat = Chat.query.get_or_404(chat_id)
        
        response = {
            'id': chat.id,
            'name': chat.name,
            'is_group': chat.is_group,
        }
        
        if chat.is_group:
            group_info = chat.group_info
            response.update({
                'participant_count': group_info['participant_count'],
                'participants': [p for p in group_info['participants']]
            })
        else:
            other_user = chat.other_user
            if other_user:
                response['other_user'] = {
                'id': other_user.id,
                'name': other_user.name,
                'avatar': other_user.avatar,
                'is_online': other_user.is_online,
                'last_seen': other_user.last_seen.isoformat() if other_user.last_seen else None
            }
        
        return jsonify(response)
    
    except Exception as e:
        # Imprime el error en la consola para depuración
        print(f"Error in get_chat_info: {e}")
        return jsonify({'error': 'Internal server error'}), 500



def comprobarInactivo():
    with app.app_context():
        try:
            # Obtener usuarios que están marcados como online
            users = User.query.filter_by(is_online=True).all()
            current_time = datetime.now()
            for user in users:
                # Verificar si el usuario no ha actualizado su estado en el último minuto
                if user.last_seen and (current_time - user.last_seen) > timedelta(minutes=1):
                    user.is_online = False
                    user.last_seen = current_time  # Actualizar last_seen al momento de desconexión
                    print(f"Usuario {user.name} marcado como inactivo a las {current_time}")
            
            db.session.commit()
            
        except Exception as e:
            print(f"Error en comprobarInactivo: {e}")
            db.session.rollback()

scheduler = BackgroundScheduler()
scheduler.add_job(func=comprobarInactivo, trigger="interval", seconds=60)

if __name__ == '__main__':
    with app.app_context():
        #db.drop_all() # Esto borra la base de datos cada vez que se reinicie el servidor
        db.create_all()
    
    scheduler.start()

    app.run(host='0.0.0.0',port=443, debug=True)
