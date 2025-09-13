document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const statusDiv = document.getElementById('status');

    uploadForm.addEventListener('submit', handleVideoUpload);

    async function handleVideoUpload(e) {
        e.preventDefault();
        
        const fileInput = document.getElementById('videoFile');
        const file = fileInput.files[0];
        
        if (!file) {
            showStatus('Please select a video file.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('video', file);

        try {
            showStatus('Uploading video...', 'info');
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.error) {
                showStatus(`Error: ${result.error}`, 'error');
                return;
            }

        } catch (error) {
            console.error('Upload error:', error);
            showStatus(`Upload failed: ${error.message}`, 'error');
        }
    }

    function showStatus(message, type) {
        statusDiv.innerHTML = `<p class="${type}">${message}</p>`;
    }

});