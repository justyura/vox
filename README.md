- Create a task
    API (fileid, userid, type) → Task Server 
                                    (taskid) CRUD
                                    DB design | status, result_fileId

- Process the task | Worker (interface)
                input
                   ↓
                Worker
                   ↓
                output

- Transcriber implement the interface
    <!-- handle the task(core logic) -->
        Download the file via FILEID from FILE SERVER
        Process
            E.P.1. go → cgo → whisper.cpp →  result_file
        RESULT
    <!-- upload the result to file server -->
        file server → Upload(filename, userid) → (fileid, link)
        upload via the link

    <!-- tell the task server -->
        fileid → Update in the task server
                Update(taskid, result_fileId)

- why seperate Tasks server and Worker, for future microservices design:
    - Soc
    - can duplicated
