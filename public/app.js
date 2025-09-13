document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const statusDiv = document.getElementById('status');
    const videoContainer = document.getElementById('videoContainer');
    const uploadedVideo = document.getElementById('uploadedVideo');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsTable = document.getElementById('resultsTable').getElementsByTagName('tbody')[0];

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

            // Show uploaded video
            // if (result.video) {
            //     uploadedVideo.src = `/${result.video}`;
            //     videoContainer.style.display = 'block';
            // }

            // Show analysis results
            if (result.results) {
                displayResults(result.results);
                
                // Show annotated video if available
                if (result.annotatedVideo) {
                    const annotatedContainer = document.getElementById('annotatedVideoContainer') || createAnnotatedVideoContainer();
                    const annotatedVideo = document.getElementById('annotatedVideo');
                    annotatedVideo.src = `/annotated/${result.annotatedVideo}`;
                    annotatedContainer.style.display = 'block';
                }
                
                showStatus('Analysis completed successfully!', 'success');
            } else {
                showStatus('Video uploaded but no analysis results available.', 'warning');
            }

        } catch (error) {
            console.error('Upload error:', error);
            showStatus(`Upload failed: ${error.message}`, 'error');
        }
    }

    function showStatus(message, type) {
        statusDiv.innerHTML = `<p class="${type}">${message}</p>`;
    }

    function displayResults(results) {
        resultsTable.innerHTML = '';
        
        if (Array.isArray(results) && results.length > 0) {
            const shadowDOM = document.createDocumentFragment();
            
            results.forEach(function(result) {
                const row = document.createElement('tr');
                row.innerHTML = `<tr>
                    <th>${result.id}</th>
                    <td>${result.speed}</td>
                    <td>${result.time} </td>
                    <td>${result.screenshot}</td>
                </tr>`;

                shadowDOM.appendChild(row);
            });
            
            resultsTable.appendChild(shadowDOM);
            resultsContainer.style.display = 'block';
        } else {
            resultsContainer.innerHTML = '<h2>Analysis Results:</h2><p>No results to display.</p>';
            resultsContainer.style.display = 'block';
        }
    }

    function createAnnotatedVideoContainer() {
        const container = document.createElement('div');
        container.id = 'annotatedVideoContainer';
        container.innerHTML = `
            <h2>Annotated Video (with overlays):</h2>
            <video id="annotatedVideo" controls width="720"></video>
        `;
        document.getElementById('videoContainer').parentNode.insertBefore(container, document.getElementById('resultsContainer'));
        return container;
    }
});