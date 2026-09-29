$(document).ready(function(){
    
    // ========== РЕГИСТРАЦИЯ ==========
    $('#67').on('submit', function(e){
        e.preventDefault();
        
        let name = $('#fullname').val().trim();
        let surname = $('#surname').val().trim();
        let email = $('#email').val().trim();
        let password = $('#password').val().trim();
        let confirm = $('#confirm_password').val().trim();
        
        // Проверки
        if (name === '') {
            alert('Введите имя!');
            return;
        }
        if (surname === '') {
            alert('Введите фамилию!');
            return;
        }
        if (email === '') {
            alert('Введите email!');
            return;
        }
        if (password.length < 6) {
            alert('Пароль должен быть минимум 6 символов!');
            return;
        }
        if (password !== confirm) {
            alert('Пароли не совпадают!');
            return;
        }
        
        // Отправка
        $.ajax({
            url: '/user_register',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                name: name,
                surname: surname,
                email: email,
                password: password
            }),
            success: function(response) {
                alert('Регистрация успешна!');
                window.location.href = '/login';
            },
            error: function(xhr) {
                let msg = xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сервера';
                alert('Ошибка: ' + msg);
            }
        });
    });
    
    // ========== ВХОД ==========
    $('#form-login').on('submit', function(e){
        e.preventDefault();
        
        let email = $('#username').val().trim();
        let password = $('#password').val().trim();
        
        if (email === '' || password === '') {
            alert('Заполните все поля!');
            return;
        }
        
        $.ajax({
            url: '/user_login',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                email: email,
                password: password
            }),
            success: function(response) {
                if (response.success) {
                    alert('Добро пожаловать, ' + response.user.username + '!\n' +
                          'Баланс: ' + response.user.balance + ' кредитов');
                    window.location.href = '/dashboard';
                } else {
                    alert('Ошибка: ' + response.error);
                }
            },
            error: function(xhr) {
                let msg = xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сервера';
                alert('Ошибка: ' + msg);
            }
        });
    });
});