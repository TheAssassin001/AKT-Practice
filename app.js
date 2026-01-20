
// Minimal JS for MCQ explanation/feedback
document.addEventListener('DOMContentLoaded', function () {
	const form = document.getElementById('mcq-form');
	const fieldset = document.getElementById('mcq-fieldset');
	const explanationBox = document.getElementById('explanation');
	const feedback = document.getElementById('feedback');
	// Dummy correct answer
	const correct = 'D';

	if (form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			// Find selected answer
			const selected = form.answer.value;
			// Show feedback
			if (selected === correct) {
				feedback.innerHTML = '<span class="correct">Correct</span>';
			} else {
				feedback.innerHTML = '<span class="incorrect">Incorrect</span>';
			}
			// Show explanation box
			explanationBox.style.display = 'block';
			// Disable all options
			Array.from(fieldset.querySelectorAll('input[type=radio]')).forEach(function (el) {
				el.disabled = true;
			});
			// Disable submit button
			form.querySelector('.submit-btn').disabled = true;
		});
	}

});

