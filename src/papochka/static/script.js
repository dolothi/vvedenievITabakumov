$(document).ready(function(){
    
    // ========== РЕГИСТРАЦИЯ ==========
    $('#67').on('submit', function(e){
        e.preventDefault();
        
        let password = $('#password').val().trim();
        let confirm = $('#confirm_password').val().trim();
        
        if ($('#fullname').val().trim() === '') {
            alert('Введите имя!');
            return;
        }
        if (password !== confirm) {
            alert('Пароли не совпадают!');
            return;
        }
        if (password.length < 6) {
            alert('Пароль должен быть минимум 6 символов!');
            return;
        }
        
        $.ajax({
            url: '/user_register',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                name: $('#fullname').val(),
                password: password,
                email: $('#email').val()
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
        
        $.ajax({
            url: '/user_login',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                email: $('#username').val(),
                password: $('#password').val()
            }),
            success: function(response) {
                alert(response.message);
                window.location.href = '/dashboard';
            },
            error: function(xhr) {
                let msg = xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сервера';
                alert('Ошибка: ' + msg);
            }
        });
    });
});