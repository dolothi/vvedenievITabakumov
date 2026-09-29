from flask import Flask, render_template, request, jsonify, session
import mysql.connector
import hashlib

app = Flask(__name__)
app.secret_key = 'spider123'

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

@app.route('/user_register', methods=['POST'])
def user_register():
    req = request.get_json()
    cnx = mysql.connector.connect(
        host="185.114.247.43",
        port=3306,
        database="sch688_vvedenie",
        user="sch688_vvedenie",
        password="Qwerty123")
    
    name = req['name']
    email = req['email']
    password_hash = hash_password(req['password'])
    
    try:
        cur = cnx.cursor()
        cur.execute(
            'INSERT INTO `users`(`username`, `email`, `password_hash`) VALUES (%s, %s, %s)',
            (name, email, password_hash)
        )
        cnx.commit()
        cnx.close()
        return jsonify({"message": "OK"}), 200
    except mysql.connector.IntegrityError:
        cnx.close()
        return jsonify({"error": "Email уже занят"}), 400
    except Exception as e:
        cnx.close()
        return jsonify({"error": str(e)}), 500

@app.route('/user_login', methods=['POST'])
def user_login():
    req = request.get_json()
    cnx = mysql.connector.connect(
        host="185.114.247.43",
        port=3306,
        database="sch688_vvedenie",
        user="sch688_vvedenie",
        password="Qwerty123")
    
    email = req['email']
    password_hash = hash_password(req['password'])
    
    cur = cnx.cursor(dictionary=True)
    cur.execute('SELECT * FROM `users` WHERE `email` = %s AND `password_hash` = %s',
                (email, password_hash))
    user = cur.fetchone()
    cnx.close()
    
    if user:
        session['user'] = user['username']
        return jsonify({"message": "Успешный вход!"}), 200
    return jsonify({"error": "Неверный email или пароль"}), 400

@app.route("/")
def registration():
    return render_template('registration.html')

@app.route("/login")
def login():
    return render_template('login.html')

@app.route("/dashboard")
def dashboard():
    if 'user' not in session:
        return '<script>window.location="/login";</script>'
    return render_template('dashboard.html', user=session['user'])

@app.route("/logout")
def logout():
    session.clear()
    return '<script>window.location="/login";</script>'

if __name__ == '__main__':
    app.run(debug=True, port=5001)